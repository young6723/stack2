declare const wx: any;

export type CloudLeaderboardEntry = {
    points: number;
    layers: number;
    nickname?: string;
    avatarUrl?: string;
    updatedAt?: number;
};

const CLOUD_ENV_ID = 'stack-8gh0yv7b83251f56';
let _cloudReady = false;

async function ensureCloudReady(): Promise<boolean> {
    if (typeof wx === 'undefined' || !wx.cloud) {
        return false;
    }
    if (!_cloudReady) {
        try {
            wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
            _cloudReady = true;
        } catch (err) {
            console.error('[CloudService] init failed', err);
            return false;
        }
    }
    return true;
}

export async function submitScoreToCloud(data: {
    points: number;
    layers: number;
    nickname?: string;
    avatarUrl?: string;
}): Promise<boolean> {
    if (!(await ensureCloudReady())) return false;
    try {
        await wx.cloud.callFunction({
            name: 'submitScore',
            data,
        });
        return true;
    } catch (err) {
        console.error('[CloudService] submitScore failed', err);
        return false;
    }
}

export async function fetchLeaderboardFromCloud(limit: number = 10): Promise<CloudLeaderboardEntry[]> {
    if (!(await ensureCloudReady())) return [];
    try {
        const res = await wx.cloud.callFunction({
            name: 'getLeaderboard',
            data: { limit },
        });
        return (res?.result?.list ?? []) as CloudLeaderboardEntry[];
    } catch (err) {
        console.error('[CloudService] fetch leaderboard failed', err);
        return [];
    }
}

