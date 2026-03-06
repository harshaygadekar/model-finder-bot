const test = require('node:test');
const assert = require('node:assert/strict');

const { commands } = require('../../src/bot/commands');

test('event start subcommand keeps required options before optional ones', () => {
  const eventCommand = commands.find((command) => command.name === 'event');
  assert.ok(eventCommand, 'expected /event command to exist');

  const eventJson = eventCommand.toJSON();
  const startSubcommand = eventJson.options.find((option) => option.name === 'start');
  assert.ok(startSubcommand, 'expected /event start subcommand to exist');

  assert.deepEqual(
    startSubcommand.options.map((option) => ({ name: option.name, required: option.required === true })),
    [
      { name: 'title', required: true },
      { name: 'keywords', required: true },
      { name: 'slug', required: false },
      { name: 'sources', required: false },
      { name: 'duration-hours', required: false },
    ]
  );
});
