'use strict';

// Install only on a dedicated creator-detail page, never on the discovery page.
// Browser-level blocking also covers preflight requests without fake responses.
async function blockDetailRecommendations(page) {
  const session = await page.createCDPSession();
  try {
    await session.send('Network.enable');
    await session.send('Network.setBlockedURLs', {
      urls: ['*/api/v1/oec/affiliate/creator/marketplace/4partner/find*'],
    });
    return session;
  } catch (error) {
    await session.detach().catch(() => {});
    throw error;
  }
}

module.exports = {blockDetailRecommendations};
