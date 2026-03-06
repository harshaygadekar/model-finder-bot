const test = require('node:test');
const assert = require('node:assert/strict');

const samples = require('../../scripts/groq-eval-corpus');
const { PRIMARY_LABELS } = require('../../src/services/classification/schema');

test('groq evaluation corpus uses unique names and valid expected labels', () => {
  const names = new Set();

  for (const sample of samples) {
    assert.equal(typeof sample.name, 'string');
    assert.equal(names.has(sample.name), false, `duplicate sample name: ${sample.name}`);
    names.add(sample.name);

    assert.ok(sample.item);
    assert.equal(typeof sample.item.title, 'string');
    assert.equal(typeof sample.item.sourceName, 'string');
    assert.equal(typeof sample.item.sourceType, 'string');

    const labels = Array.isArray(sample.expected?.labels)
      ? sample.expected.labels
      : [sample.expected?.label].filter(Boolean);
    assert.ok(labels.length > 0, `sample ${sample.name} must declare at least one expected label`);
    for (const label of labels) {
      assert.equal(PRIMARY_LABELS.includes(label), true, `invalid expected label ${label} for ${sample.name}`);
    }
  }
});