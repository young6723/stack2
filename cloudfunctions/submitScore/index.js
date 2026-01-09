const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const leaderboard = db.collection('leaderboard');

exports.main = async (event, context) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const points = Number(event.points) || 0;
    const layers = Number(event.layers) || 0;
    const nickname = event.nickname || '';
    const avatarUrl = event.avatarUrl || '';
    const now = Date.now();

    await leaderboard.doc(OPENID).set({
      data: {
        points,
        layers,
        nickname,
        avatarUrl,
        updatedAt: now
      }
    });

    return { success: true };
  } catch (error) {
    console.error('submitScore error', error);
    return { success: false, error: error.message };
  }
};
