import { sys } from 'cc';

declare const wx: any;

export type WxUserProfile = {
    nickName: string;
    avatarUrl: string;
};

export type WxSharePayload = {
    title: string;
    imageUrl?: string;
    query?: string;
};

export type WxLifecycleHandlers = {
    onHide?: () => void;
    onShow?: () => void;
};

export type WxRewardedVideoOptions = {
    mockInEditor?: boolean;
    mockDelayMs?: number;
};

export class WxGamePlatform {
    private static _instance: WxGamePlatform | null = null;

    public static getInstance(): WxGamePlatform {
        if (!WxGamePlatform._instance) {
            WxGamePlatform._instance = new WxGamePlatform();
        }
        return WxGamePlatform._instance;
    }

    private _lifecycleOnHide: (() => void) | null = null;
    private _lifecycleOnShow: (() => void) | null = null;
    private _shareFactory: (() => WxSharePayload) | null = null;
    private _shareAppMessageHandler: (() => WxSharePayload) | null = null;
    private _shareTimelineHandler: (() => WxSharePayload) | null = null;
    private _rewardedAd: any = null;
    private _rewardedAdUnitId = '';
    private _rewardedAdErrorHandler: ((err: any) => void) | null = null;

    private constructor() {}

    public isWechatGame(): boolean {
        return sys.platform === sys.Platform.WECHAT_GAME && !!this.getEnv();
    }

    public getEnv(): any {
        if (typeof wx !== 'undefined') return wx;
        if (typeof window !== 'undefined' && (window as any).wx) return (window as any).wx;
        return null;
    }

    public registerLifecycle(handlers: WxLifecycleHandlers): boolean {
        this.unregisterLifecycle();
        if (!this.isWechatGame()) return false;
        const env = this.getEnv();
        if (!env) return false;

        if (handlers.onHide) {
            this._lifecycleOnHide = () => {
                try {
                    handlers.onHide?.();
                } catch (err) {
                    console.warn('[WxGamePlatform] onHide handler failed', err);
                }
            };
            env.onHide?.(this._lifecycleOnHide);
        }

        if (handlers.onShow) {
            this._lifecycleOnShow = () => {
                try {
                    handlers.onShow?.();
                } catch (err) {
                    console.warn('[WxGamePlatform] onShow handler failed', err);
                }
            };
            env.onShow?.(this._lifecycleOnShow);
        }

        return true;
    }

    public unregisterLifecycle(): void {
        const env = this.getEnv();
        if (env) {
            if (this._lifecycleOnHide) env.offHide?.(this._lifecycleOnHide);
            if (this._lifecycleOnShow) env.offShow?.(this._lifecycleOnShow);
        }
        this._lifecycleOnHide = null;
        this._lifecycleOnShow = null;
    }

    public registerShare(factory: () => WxSharePayload): boolean {
        this.unregisterShare();
        if (!this.isWechatGame()) return false;
        const env = this.getEnv();
        if (!env?.showShareMenu) return false;

        this._shareFactory = factory;
        env.showShareMenu?.({
            withShareTicket: true,
            menus: ['shareAppMessage', 'shareTimeline'],
        });

        this._shareAppMessageHandler = () => this.buildSharePayload();
        this._shareTimelineHandler = () => this.buildSharePayload();

        env.onShareAppMessage?.(this._shareAppMessageHandler);
        env.onShareTimeline?.(this._shareTimelineHandler);
        return true;
    }

    public unregisterShare(): void {
        const env = this.getEnv();
        if (env) {
            if (this._shareAppMessageHandler) env.offShareAppMessage?.(this._shareAppMessageHandler);
            if (this._shareTimelineHandler) env.offShareTimeline?.(this._shareTimelineHandler);
        }
        this._shareFactory = null;
        this._shareAppMessageHandler = null;
        this._shareTimelineHandler = null;
    }

    public ensureRewardedAd(adUnitId: string, onError?: (err: any) => void): any {
        if (!this.isWechatGame()) return null;
        if (!adUnitId) return null;
        if (this._rewardedAd && this._rewardedAdUnitId === adUnitId) return this._rewardedAd;

        this.disposeRewardedAd();

        const env = this.getEnv();
        if (!env?.createRewardedVideoAd) return null;

        try {
            this._rewardedAd = env.createRewardedVideoAd({ adUnitId });
            this._rewardedAdUnitId = adUnitId;
            this._rewardedAdErrorHandler = (err: any) => {
                try {
                    onError?.(err);
                } catch (innerErr) {
                    console.warn('[WxGamePlatform] rewarded ad error handler failed', innerErr);
                }
            };
            this._rewardedAd.onError?.(this._rewardedAdErrorHandler);
            return this._rewardedAd;
        } catch (err) {
            console.warn('[WxGamePlatform] createRewardedVideoAd failed', err);
            this.disposeRewardedAd();
            return null;
        }
    }

    public hasRewardedAd(adUnitId?: string): boolean {
        if (!this.isWechatGame()) return false;
        if (adUnitId && adUnitId !== this._rewardedAdUnitId) {
            this.ensureRewardedAd(adUnitId);
        }
        return !!this._rewardedAd;
    }

    public showRewardedVideoAd(options: WxRewardedVideoOptions = {}): Promise<boolean> {
        if (!this.isWechatGame()) {
            if (!options.mockInEditor) {
                return Promise.resolve(false);
            }
            return new Promise((resolve) => {
                setTimeout(() => resolve(true), options.mockDelayMs ?? 300);
            });
        }

        const ad = this._rewardedAd;
        if (!ad) return Promise.resolve(false);

        return new Promise((resolve) => {
            let settled = false;
            let closeHandler: ((res: any) => void) | null = null;
            let errorHandler: ((err: any) => void) | null = null;

            const cleanup = () => {
                if (closeHandler) ad.offClose?.(closeHandler);
                if (errorHandler) ad.offError?.(errorHandler);
            };

            const finish = (result: boolean) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(result);
            };

            closeHandler = (res: any) => {
                finish(res?.isEnded !== false);
            };
            errorHandler = (err: any) => {
                console.warn('[WxGamePlatform] rewarded video show failed', err);
                finish(false);
            };

            ad.onClose?.(closeHandler);
            ad.onError?.(errorHandler);

            try {
                const showResult = ad.show?.();
                if (showResult && typeof showResult.catch === 'function') {
                    showResult
                        .catch(() => {
                            const loadResult = ad.load?.();
                            if (loadResult && typeof loadResult.then === 'function') {
                                return loadResult.then(() => ad.show?.());
                            }
                            throw new Error('rewarded ad load unavailable');
                        })
                        .catch(errorHandler);
                }
            } catch (err) {
                errorHandler(err);
            }
        });
    }

    public disposeRewardedAd(): void {
        if (this._rewardedAd && this._rewardedAdErrorHandler) {
            this._rewardedAd.offError?.(this._rewardedAdErrorHandler);
        }
        try {
            this._rewardedAd?.destroy?.();
        } catch (err) {
            console.warn('[WxGamePlatform] destroy rewarded ad failed', err);
        }
        this._rewardedAd = null;
        this._rewardedAdUnitId = '';
        this._rewardedAdErrorHandler = null;
    }

    public postOpenDataMessage(message: Record<string, unknown>): boolean {
        const env = this.getEnv();
        const ctx = env?.getOpenDataContext?.();
        if (!ctx?.postMessage) return false;
        try {
            ctx.postMessage(message);
            return true;
        } catch (err) {
            console.warn('[WxGamePlatform] postOpenDataMessage failed', err);
            return false;
        }
    }

    public setUserCloudStorage(data: { points: number; layers: number }, debugLog = false): boolean {
        if (!this.isWechatGame()) return false;
        const env = this.getEnv();
        if (!env?.setUserCloudStorage) return false;

        const points = Math.max(0, Math.floor(data.points));
        const layers = Math.max(0, Math.floor(data.layers));
        try {
            env.setUserCloudStorage({
                KVDataList: [
                    { key: 'points', value: String(points) },
                    { key: 'layers', value: String(layers) },
                ],
                success: () => {
                    if (debugLog) {
                        console.log('[WxGamePlatform] setUserCloudStorage ok', points, layers);
                    }
                },
                fail: (err: any) => {
                    if (debugLog) {
                        console.warn('[WxGamePlatform] setUserCloudStorage failed', err);
                    }
                },
            });
            return true;
        } catch (err) {
            if (debugLog) {
                console.warn('[WxGamePlatform] setUserCloudStorage threw', err);
            }
            return false;
        }
    }

    public async getUserProfile(desc: string): Promise<WxUserProfile | null> {
        const env = this.getEnv();
        if (!env?.getUserProfile) return null;

        try {
            const profile = await new Promise<WxUserProfile>((resolve, reject) => {
                env.getUserProfile({
                    desc,
                    success: (res: any) => resolve({
                        nickName: res?.userInfo?.nickName ?? '',
                        avatarUrl: res?.userInfo?.avatarUrl ?? '',
                    }),
                    fail: reject,
                });
            });
            return profile;
        } catch (err) {
            console.warn('[WxGamePlatform] getUserProfile failed', err);
            return null;
        }
    }

    public dispose(): void {
        this.unregisterLifecycle();
        this.unregisterShare();
        this.disposeRewardedAd();
    }

    private buildSharePayload(): WxSharePayload {
        const payload = this._shareFactory?.() ?? { title: '方块堆堆高' };
        return {
            title: payload.title || '方块堆堆高',
            imageUrl: payload.imageUrl || undefined,
            query: payload.query || '',
        };
    }
}
