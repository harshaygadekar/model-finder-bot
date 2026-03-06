#!/usr/bin/env node

require('dotenv').config();

const samples = require('./groq-eval-corpus');
const { classifyWithKeywords } = require('../src/services/classification/keyword-classifier');
const {
  DEFAULT_MODEL,
  buildPrompt,
  buildSystemPrompt,
  extractGroqContent,
  getGroqResponseFormat,
  normalizeGroqResponseContent,
  parseGroqResponseContent,
  sendGroqClassificationRequest,
} = require('../src/services/classification/groq-classifier');

const sampleFilter = process.argv.includes('--sample')
  ? process.argv[process.argv.indexOf('--sample') + 1]
  : (process.env.GROQ_EVAL_SAMPLE || null);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function includesLoosely(actualValue, expectedValue) {
  const actual = normalizeText(actualValue);
  const expected = normalizeText(expectedValue);
  if (!actual || !expected) return false;
  return actual.includes(expected) || expected.includes(actual);
}

function matchesAny(actualValue, expectedValues) {
  const values = asArray(expectedValues).filter(Boolean);
  if (values.length === 0) return null;
  return values.some((value) => includesLoosely(actualValue, value));
}

function computeProductionWouldUseGroq(item, keywordResult) {
  if (!process.env.GROQ_API_KEY) return false;

  const ambiguityMin = Number(process.env.CLASSIFIER_AMBIGUITY_MIN || 0.3);
  const ambiguityMax = Number(process.env.CLASSIFIER_AMBIGUITY_MAX || 0.7);
  const inAmbiguityBand = keywordResult.confidence >= ambiguityMin && keywordResult.confidence <= ambiguityMax;
  const isHighValue = item.priority <= 1;
  const isRumor = keywordResult.label === 'rumor_or_leak';

  return inAmbiguityBand || isHighValue || isRumor;
}

function evaluateResult(sample, normalizedResult) {
  const expected = sample.expected || {};
  const entityBundle = [
    normalizedResult?.entities?.modelFamily,
    normalizedResult?.entities?.modelId,
  ].filter(Boolean).join(' ');

  const checks = {
    labelMatch: asArray(expected.labels).includes(normalizedResult?.label),
    providerMatch: matchesAny(normalizedResult?.entities?.provider, expected.provider),
    modelFamilyMatch: matchesAny(entityBundle, expected.modelFamilyIncludes),
    releaseSurfaceMatch: matchesAny(normalizedResult?.entities?.releaseSurface, expected.releaseSurfaces),
  };

  const optionalChecks = ['providerMatch', 'modelFamilyMatch', 'releaseSurfaceMatch']
    .filter((key) => checks[key] !== null);
  const failedOptionalChecks = optionalChecks.filter((key) => checks[key] === false);

  let status = 'fail';
  if (checks.labelMatch && failedOptionalChecks.length === 0) {
    status = 'pass';
  } else if (checks.labelMatch) {
    status = 'review';
  }

  return {
    status,
    checks,
    failedOptionalChecks,
  };
}

async function run() {
  const model = process.env.CLASSIFIER_MODEL || DEFAULT_MODEL;
  const timeout = Number(process.env.CLASSIFIER_TIMEOUT_MS || 7000);
  const maxInputChars = Number(process.env.CLASSIFIER_MAX_INPUT_CHARS || 1800);
  const temperature = 0;
  const seed = Number(process.env.CLASSIFIER_EVAL_SEED || 42);
  const selectedSamples = sampleFilter
    ? samples.filter((sample) => sample.name === sampleFilter)
    : samples;

  if (!process.env.GROQ_API_KEY) {
    console.error(JSON.stringify({ ok: false, error: 'GROQ_API_KEY is not set in environment' }, null, 2));
    process.exit(2);
  }

  if (selectedSamples.length === 0) {
    console.error(JSON.stringify({ ok: false, error: `No sample found for ${sampleFilter}` }, null, 2));
    process.exit(2);
  }

  const output = {
    ok: true,
    timestamp: new Date().toISOString(),
    model,
    temperature,
    seed,
    responseFormat: getGroqResponseFormat(model),
    summary: {
      totalSamples: selectedSamples.length,
      passCount: 0,
      reviewCount: 0,
      failCount: 0,
      labelMatchCount: 0,
      repairUsedCount: 0,
      productionWouldUseGroqCount: 0,
    },
    results: [],
  };

  for (const sample of selectedSamples) {
    const keywordResult = classifyWithKeywords(sample.item);
    const productionWouldUseGroq = computeProductionWouldUseGroq(sample.item, keywordResult);
    if (productionWouldUseGroq) {
      output.summary.productionWouldUseGroqCount += 1;
    }

    const entry = {
      sample: sample.name,
      adapterLikeSource: sample.adapterLikeSource,
      notes: sample.notes,
      expected: sample.expected,
      productionWouldUseGroq,
      keyword: keywordResult,
    };

    try {
      const rawStarted = Date.now();
      const rawResponse = await sendGroqClassificationRequest({
        model,
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(model),
          },
          {
            role: 'user',
            content: buildPrompt(sample.item, keywordResult, maxInputChars),
          },
        ],
        timeout,
        temperature,
        seed,
      });
      const rawContent = extractGroqContent(rawResponse);
      const normalizedStarted = Date.now();
      const normalizedResult = await normalizeGroqResponseContent(rawContent, {
        item: sample.item,
        keywordResult,
        model,
        timeout,
        maxInputChars,
        temperature,
        seed,
      });
      const evaluation = evaluateResult(sample, normalizedResult);

      entry.raw = {
        latencyMs: Date.now() - rawStarted,
        finishReason: rawResponse.data?.choices?.[0]?.finish_reason || null,
        parsed: parseGroqResponseContent(rawContent),
        contentPreview: String(rawContent).slice(0, 320),
        usage: rawResponse.data?.usage || null,
      };
      entry.normalized = {
        normalizationLatencyMs: Date.now() - normalizedStarted,
        result: normalizedResult,
      };
      entry.evaluation = evaluation;

      if (evaluation.checks.labelMatch) {
        output.summary.labelMatchCount += 1;
      }
      if (normalizedResult.repairUsed) {
        output.summary.repairUsedCount += 1;
      }

      if (evaluation.status === 'pass') {
        output.summary.passCount += 1;
      } else if (evaluation.status === 'review') {
        output.summary.reviewCount += 1;
      } else {
        output.summary.failCount += 1;
        output.ok = false;
      }
    } catch (error) {
      output.ok = false;
      output.summary.failCount += 1;
      entry.error = error.message;
    }

    output.results.push(entry);
  }

  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});