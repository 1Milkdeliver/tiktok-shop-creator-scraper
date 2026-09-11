'use strict';

// The production contact consumer already observes runner.paused and the
// verification gate. Stopping it destroys the open streaming input and cannot
// be undone by the current Resume button.
async function pauseForStabilityRestriction(page) {
  return page.evaluate(() => window.api.pause());
}

module.exports = {pauseForStabilityRestriction};
