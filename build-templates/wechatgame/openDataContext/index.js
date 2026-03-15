const env = GameGlobal.wx || GameGlobal.tt || GameGlobal.swan;

if (!env || !env.getSharedCanvas) {
  console.warn('[OpenData] unsupported environment');
}

const sharedCanvas = env?.getSharedCanvas ? env.getSharedCanvas() : null;
const ctx = sharedCanvas ? sharedCanvas.getContext('2d') : null;

const state = {
  width: 500,
  height: 850,
  visible: false,
  list: [],
};

function parseKV(kvList, key, fallback) {
  if (!Array.isArray(kvList)) return fallback;
  const found = kvList.find((item) => item && item.key === key);
  if (!found || typeof found.value !== 'string') return fallback;
  const value = Number(found.value);
  return Number.isFinite(value) ? value : fallback;
}

function clampSize(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const rounded = Math.max(2, Math.floor(n));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function resizeCanvas(width, height) {
  if (!sharedCanvas) return;
  const nextWidth = clampSize(width, state.width);
  const nextHeight = clampSize(height, state.height);
  state.width = nextWidth;
  state.height = nextHeight;
  if (sharedCanvas.width !== nextWidth) sharedCanvas.width = nextWidth;
  if (sharedCanvas.height !== nextHeight) sharedCanvas.height = nextHeight;
}

function drawRoundedRect(x, y, width, height, radius, fillStyle) {
  if (!ctx) return;
  const r = Math.max(0, Math.min(radius, Math.min(width, height) * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function ellipsize(text, maxWidth) {
  if (!ctx) return text;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(result + '...').width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + '...';
}

function drawEmptyState() {
  if (!ctx) return;
  ctx.fillStyle = 'rgba(34, 34, 34, 0.55)';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('暂无好友成绩', state.width / 2, state.height / 2);
}

function drawList() {
  if (!ctx || !sharedCanvas || !state.visible) return;

  ctx.clearRect(0, 0, state.width, state.height);
  drawRoundedRect(0, 0, state.width, state.height, 24, '#ffffff');

  ctx.fillStyle = '#202020';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('好友榜', state.width / 2, 52);

  const top = 90;
  const rowHeight = Math.max(60, Math.floor((state.height - top - 60) / 10));
  const list = state.list.slice(0, 10);

  if (list.length === 0) {
    drawEmptyState();
  } else {
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i];
      const y = top + i * rowHeight;
      drawRoundedRect(18, y, state.width - 36, rowHeight - 10, 16, i % 2 === 0 ? '#f5f7fb' : '#eef2f8');

      ctx.fillStyle = i === 0 ? '#d29a00' : '#47321f';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(i + 1), 36, y + rowHeight * 0.58);

      ctx.fillStyle = '#1f2937';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(ellipsize(row.nickname || '微信玩家', state.width * 0.42), 84, y + rowHeight * 0.58);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${row.points} 分`, state.width - 36, y + rowHeight * 0.58);
    }
  }

  ctx.fillStyle = 'rgba(32, 32, 32, 0.45)';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`展示前 ${Math.max(1, Math.min(10, state.list.length || 0))} 位好友`, state.width / 2, state.height - 22);
}

function loadFriendData() {
  if (!env?.getFriendCloudStorage) {
    state.list = [];
    drawList();
    return;
  }

  env.getFriendCloudStorage({
    keyList: ['points', 'layers'],
    success: (res) => {
      const list = Array.isArray(res?.data) ? res.data : [];
      state.list = list
        .map((item) => ({
          nickname: item?.nickname || '微信玩家',
          points: parseKV(item?.KVDataList, 'points', 0),
          layers: parseKV(item?.KVDataList, 'layers', 0),
        }))
        .sort((a, b) => (b.points - a.points) || (b.layers - a.layers));
      drawList();
    },
    fail: (err) => {
      console.warn('[OpenData] getFriendCloudStorage failed', err);
      state.list = [];
      drawList();
    },
  });
}

function handleShow(message) {
  state.visible = true;
  resizeCanvas(message?.width, message?.height);
  drawList();
  loadFriendData();
}

function handleHide() {
  state.visible = false;
  if (ctx) ctx.clearRect(0, 0, state.width, state.height);
}

if (env?.onMessage) {
  env.onMessage((message) => {
    if (message?.type === 'engine' && message?.event === 'viewport') {
      resizeCanvas(message.width, message.height);
      if (state.visible) drawList();
      return;
    }

    if (message?.type === 'SHOW_FRIEND_RANK' || message?.type === 'SHOW') {
      handleShow(message);
      return;
    }

    if (message?.type === 'HIDE_FRIEND_RANK' || message?.type === 'HIDE') {
      handleHide();
    }
  });
}

console.log('[OpenData] ready');
