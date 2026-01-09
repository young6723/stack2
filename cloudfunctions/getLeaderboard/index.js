const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const leaderboard = db.collection('leaderboard');

exports.main = async (event, context) => {
  try {
    const limit = Math.min(Math.max(parseInt(event.limit, 10) || 10, 1), 50);
    const res = await leaderboard
      .orderBy('points', 'desc')
      .orderBy('layers', 'desc')
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    return { success: true, list: res.data };
  } catch (error) {
    console.error('getLeaderboard error', error);
    return { success: false, error: error.message, list: [] };
  }
};
