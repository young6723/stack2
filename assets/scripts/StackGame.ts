// Import necessary Cocos Creator modules
import { _decorator, Component, Node, input, Input, Vec3, instantiate, Prefab, tween, Tween, Color, MeshRenderer, AudioSource, AudioClip, UIOpacity, screen, view, Material, EventKeyboard, KeyCode, Label, UITransform, Canvas, Camera, Layers, director, LabelOutline, LabelShadow, Vec2, sys } from 'cc';
import { FriendRankView } from './FriendRankView';
declare const wx: any;
type LeaderboardRowRefs = {
    rankLabel: Label;
    pointsLabel: Label;
    layersLabel: Label;
    crownNode?: Node;
};
type LeaderboardEntry = {
    points: number;
    layers: number;
    date: number;
    nickname?: string;
    avatarUrl?: string;
};
type LeaderboardView = {
    root: Node;
    rows: LeaderboardRowRefs[];
};


const LB_KEY = 'stack_leaderboard_v1';
const { ccclass, property } = _decorator;

@ccclass('StackGame')
export class StackGame extends Component {
    @property(Prefab)
    blockPrefab: Prefab = null;

    @property(Material)
    haloMaterial: Material = null; // 可选：光环专用材质（建议使用 Unlit/纯色材质）

    @property(Prefab)
    perfectEffectPrefab: Prefab = null;

    @property(Node)
    cameraNode: Node = null;

    @property(Node)
    backgroundPlane: Node = null;

    @property(AudioClip)
    blockStackSound: AudioClip = null;

    @property(AudioClip)
    blockStackSoundHigh: AudioClip = null; // 升调版完美堆叠音效（资源层面处理）

    @property(AudioClip)
    blockStackSoundHigh1: AudioClip = null; // +1 档（可选）

    @property(AudioClip)
    blockStackSoundHigh2: AudioClip = null; // +2 档（可选）

    @property(AudioClip)
    blockStackSoundHigh3: AudioClip = null; // +3 档（可选）

    @property(AudioClip)
    blockStackSoundHigh4: AudioClip = null; // +4 档（可选）

    @property(AudioClip)
    blockStackSoundHigh5: AudioClip = null; // +5 档（可选）

    @property(AudioClip)
    blockStackSoundHigh6: AudioClip = null; // +6 档（可选）

    @property(AudioClip)
    blockCutSound: AudioClip = null;

    @property(AudioClip)
    bgmClip: AudioClip = null;      // 背景音乐音频（循环播放）

    @property
    bgmVolume: number = 0.5;        // BGM 目标音量（0~1）

    @property
    bgmFadeIn: number = 0.8;        // 进场淡入时长（秒）

    @property
    bgmFadeOut: number = 0.6;       // 游戏结束淡出时长（秒）

    @property
    baseBlockHeight: number = 1;

    @property
    movingBlockHeight: number = 0.7;

    @property
    initialBlockScale: number = 0.78;   // 0.5~1.0，初始底座与第一块的 X/Z 缩放（初始底座和第一块的 X/Z 缩小，自动按屏幕比例微调）

    // ===== 计分配置 =====
    @property
    pointsPerLayer: number = 10;    // 每放置一层的基础分

    @property
    perfectBonus: number = 10;      // 完美堆叠额外加分

    @property
    streakBonus: number = 5;        // 连击每多 1 次的额外加分

    @property
    debugLogScores: boolean = true; // 调试：打印分数/层数日志

    // ===== UI（代码动态创建） =====
    private uiCanvas: Node = null;              // 运行时创建的 Canvas
    private mainScoreLabelNode: Node = null;    // 主分数 Label（总分）
    private subLayerLabelNode: Node = null;     // 副显示 Label（层数）
    private comboBadgeNode: Node = null;        // 连击徽章（UI 动态创建）
    // —— Start Overlay —— 
    @property
    startOnTap: boolean = true; // 允许点击屏幕/按键开始
    @property
    showLeaderboardOnStart: boolean = false; // 是否在开始遮罩显示排行榜（默认不显示）
    private startOverlayNode: Node = null;      // 开始遮罩根节点
    private isWaitingStart: boolean = true;     // 开局等待开始

    // —— GameOver Overlay ——
    @property
    restartOnTap: boolean = true;               // 允许点击遮罩重新开始
    private gameOverOverlayNode: Node = null;   // 结束遮罩根节点
    private _isSceneLoading: boolean = false;

    // —— 复活/激励视频 —— 
    @property
    enableReviveAd: boolean = true;             // 是否启用“看广告复活”
    @property
    reviveAdUnitId: string = '';                // 激励视频广告位 ID（微信后台获取）
    @property
    reviveMaxTimes: number = 1;                 // 单局可复活次数
    @property
    mockReviveInEditor: boolean = true;         // 非微信环境下是否直接模拟成功，便于调试
    @property
    reviveMinScaleRatio: number = 0.65;         // 复活时底块的最小 X/Z 比例（相对于初始底座尺寸），太薄则回填到该比例
    private _reviveOverlayNode: Node = null;    // 复活弹窗节点
    private _rewardedAd: any = null;            // 微信激励视频实例
    private _reviveRequesting: boolean = false; // 正在请求广告
    private _reviveCount: number = 0;           // 已使用复活次数
    private _gameOverFinalized: boolean = false; // 防止重复结算

    private movingBlock: Node = null;
    private baseBlock: Node = null;
    private bgmSource: AudioSource = null;
    private _bgmStarted: boolean = false; // 解决浏览器自动播放限制：必须在用户交互后再启动 BGM

    // 在首次用户交互（触摸/鼠标/键盘）后再启动 BGM，避免浏览器拦截
    private _bindUserGestureForBGM() {
        if (!this.bgmClip || this._bgmStarted) return;
        const startBGM = () => {
            if (this._bgmStarted) return;
            this._bgmStarted = true;
            this._initBGM();
        };
        // 只需要触发一次即可；触发后由 _initBGM() 正常淡入播放
        input.once(Input.EventType.TOUCH_START, startBGM, this);
        input.once(Input.EventType.MOUSE_DOWN, startBGM, this);
        input.once(Input.EventType.KEY_DOWN, startBGM, this);
    }
    // FriendRank 面板是否正在显示（用于屏蔽全局落块触摸）
    private _isFriendRankActive(): boolean {
        return FriendRankView.isActive();
    }

    // 触摸是否落在好友榜相关 UI 上（按钮 / 关闭按钮 / 遮罩）
    private _isEventOnFriendRankUI(evt: any): boolean {
        if (!evt) return false;
        const loc = evt?.getUILocation?.() || evt?.getLocation?.();
        return FriendRankView.hitTestUI(evt, loc);
    }
    private direction: number = 1;
    @property
    moveSpeed: number = 3.4;        // 起步略快，减少“发涩”感

    @property
    moveSpeedMax: number = 9.0;     // 顶速略放开，后期更刺激

    @property
    moveSpeedStep: number = 0.18;   // 每次加速幅度更大

    @property
    moveSpeedEvery: number = 1;     // 每层都加速（更顺手）

    @property
    missSlowRatio: number = 0.98;   // 失误时的速度保留比例（原 0.94，降速更轻）

    @property
    missSlowFloor: number = 3.0;    // 失误后最低不低于此值（配合起步手感）

    @property
    earlyGraceLayers: number = 4;     // 前 N 层不因完美加速（防止开局过快）

    @property
    perPlacementAccelCap: number = 0.15; // 单次放置的总加速上限（普通+完美合并后不超过该值）

    @property
    perfectAccelBase: number = 0.06;  // 完美基础加速（原 0.06）

    @property
    perfectAccelPerCombo: number = 0.02; // 连击额外加速（每点连击增加），最终仍会被夹到上限

    @property
    moveRange: number = 3;          // 移动边界（±moveRange）
    @property
    cameraHoldLayers: number = 5;     // 前几层不抬相机；超过该层数后才开始上移
    @property
    spawnOvershoot: number = 1.4;     // 生成时从边界外更远处滑入（>1 表示更远，1 表示刚好在边界）
    @property
    useProceduralBurst: boolean = true; // 第5次及以后是否使用纯代码生成的四向爆发
    @property
    burstComboThreshold: number = 5;    // 触发四向爆发的连击阈值（包含）
    private isGameOver: boolean = false;
    private score: number = 0;
    private points: number = 0;     // 总分（主显示）
    private _matColorKey: string | null = null; // 记录当前材质颜色属性键（兼容 albedo/mainColor/baseColor/u_color/color）
    private moveAxis: 'x' | 'z' = 'z'; // 初始为 z 轴

    private baseHueOffset: number = 0;

    protected onLoad(): void {
        // 初始隐藏好友榜面板，等按钮点击后再显示
        try { FriendRankView.hide?.(); } catch (e) { console.warn('[FriendRank] hide on load failed', e); }
        const scene = director.getScene();
        const canvas = scene?.getChildByName('Canvas');
        const fr = canvas?.getChildByName('FriendRankRoot') ?? scene?.getChildByName('FriendRankRoot');
        if (fr && fr.isValid) {
            fr.active = false;
        }
    }

    // ===== 颜色：递增色相 + 好看曲线（保持你原来的递增风格） =====
    @property
    hueStep: number = 10;       // 每层色相步进（°）
    @property
    satBase: number = 0.58;     // 基础饱和（0~1）
    @property
    satVar: number = 0.10;      // 饱和摆动幅度
    @property
    lightBase: number = 0.62;   // 基础亮度（0~1）
    @property
    lightVar: number = 0.06;    // 亮度摆动幅度
    @property
    levelBrighten: number = 0.002; // 随层整体轻微变亮（每层 +0.2%）

    // —— 连续完美成长（字段，仅声明，下一步再接入逻辑） ——
    @property
    streakGrowEvery: number = 7;     // 每累计 7 次完美，触发一次增大（X/Z）
    @property
    streakGrowFactor: number = 1.3; // 每次触发放大比例

    private _baseMaxX: number = 0;   // 初始 X 作为放大上限
    private _baseMaxZ: number = 0;   // 初始 Z 作为放大上限
    private _cameraBasePos: Vec3 | null = null; // 记录场景里设置的初始相机位置，抬升时沿用 X/Z
    private _cameraBaseEuler: Vec3 | null = null; // 记录初始欧拉角，拉远时沿用
    private _cameraBaseOrtho: number | null = null; // 记录初始正交高度，拉远时放大

    // —— 分享配置（微信小游戏） ——
    @property
    shareTitle: string = '方块堆堆高';
    @property
    shareImageUrl: string = ''; // 建议填写 5:4 或 1:1 的 https 图
    @property
    shareQuery: string = '';    // 追加到分享 query 的参数，例如 "from=share"

    // 连击计数：连续完美堆叠次数（非完美或失败时清零）
    private comboCount: number = 0;

    private _tmpPos: Vec3 = new Vec3(); // 复用的临时向量，减少 GC 抖动
    private _profileCache: { nickName: string; avatarUrl: string } | null = null;
    private _leaderboardViews: LeaderboardView[] = [];

    // ===== UI scale baseline (avoid cumulative growth when punch-scaling) =====
    private _uiBaseScale: Map<Node, Vec3> = new Map();
    private _rememberBaseScale(n: Node | null) {
        if (!n || !n.isValid) return;
        if (!this._uiBaseScale.has(n)) this._uiBaseScale.set(n, n.scale.clone());
    }
    private _isAlive(node?: Node | null): boolean {
        return !!(node && node.isValid);
    }

    // ===== 简易对象池（降低 instantiate/destroy 带来的 GC 抖动） =====
    private _pool: { block: Node[]; strip: Node[]; effect: Node[] } = { block: [], strip: [], effect: [] };

    private _recycle(node: Node, type: 'block' | 'strip' | 'effect'): void {
        if (!node || !node.isValid) return;
        Tween.stopAllByTarget(node);
        node.children.forEach(child => Tween.stopAllByTarget(child));
        node.removeFromParent();
        node.setScale(1, 1, 1);
        node.setRotationFromEuler(0, 0, 0);
        node.setPosition(0, 0, 0);
        if (type === 'block') {
            this._pool.block.push(node);
        } else if (type === 'strip') {
            this._pool.strip.push(node);
        } else {
            node.active = false;
            this._resetEffectNode(node);
            this._pool.effect.push(node);
        }
    }

    private _acquireBlock(): Node {
        return this._pool.block.pop() ?? instantiate(this.blockPrefab);
    }

    private _acquireStrip(): Node {
        // 光环/爆发条带也复用 blockPrefab 的网格
        return this._pool.strip.pop() ?? instantiate(this.blockPrefab);
    }

    private _acquireEffect(): Node | null {
        if (!this.perfectEffectPrefab) return null;
        const node = this._pool.effect.pop() ?? instantiate(this.perfectEffectPrefab);
        node.active = true;
        this._resetEffectNode(node);
        return node;
    }

    private _resetEffectNode(effect: Node): void {
        const cacheKey = '__defaults';
        let defaults = (effect as any)[cacheKey] as Array<{ child: Node; pos: Vec3; scale: Vec3; rot: Vec3; active: boolean }>;
        if (!defaults) {
            defaults = effect.children.map(child => ({
                child,
                pos: child.position.clone(),
                scale: child.scale.clone(),
                rot: new Vec3(child.eulerAngles),
                active: child.active
            }));
            (effect as any)[cacheKey] = defaults;
        }
        effect.setScale(1, 1, 1);
        effect.setRotationFromEuler(0, 0, 0);
        defaults.forEach(entry => {
            const child = entry.child;
            if (!child || !child.isValid) return;
            Tween.stopAllByTarget(child);
            child.setPosition(entry.pos);
            child.setScale(entry.scale);
            child.setRotationFromEuler(entry.rot.x, entry.rot.y, entry.rot.z);
            child.active = entry.active;
            const op = child.getComponent(UIOpacity);
            if (op) op.opacity = 0;
        });
    }

    // 计算初始底座与第一块的 X/Z 缩放，自动根据屏幕高宽比微调，防止初始方块超出画面
    private _calcInitialBlockScale(): number {
        const base = Math.max(0.5, Math.min(1.0, this.initialBlockScale));
        const w = screen?.windowSize?.width ?? 1080;
        const h = screen?.windowSize?.height ?? 2340;
        const ar = h / Math.max(1, w); // portrait aspect
        // Auto-tune for very tall phones to avoid initial block cropping.
        // Typical thresholds: ~1.78(16:9), ~2.16(19.5:9), >=2.3 very tall
        let s = base;
        if (ar >= 2.3) {
            s = Math.min(s, 0.72);
        } else if (ar >= 2.0) {
            s = Math.min(s, 0.75);
        } else if (ar >= 1.9) {
            s = Math.min(s, 0.77);
        }
        return Math.max(0.5, Math.min(1.0, s));
    }


    // 统一给 Label 应用描边/阴影（使用 Label 的新属性，避免旧组件属性的弃用警告）
    private _styleLabel(lab: Label, opt: { outlineColor?: Color; outlineWidth?: number; shadowColor?: Color; shadowOffset?: Vec2; shadowBlur?: number }) {
        const L: any = lab as any;
        if (opt.outlineColor !== undefined) { L.useOutline = true; L.outlineColor = opt.outlineColor; }
        if (opt.outlineWidth !== undefined) { L.outlineWidth = opt.outlineWidth; }
        if (opt.shadowColor !== undefined) { L.useShadow = true; L.shadowColor = opt.shadowColor; }
        if (opt.shadowOffset !== undefined) { L.shadowOffset = opt.shadowOffset; }
        if (opt.shadowBlur !== undefined) { L.shadowBlur = opt.shadowBlur; }
    }

    // —— 自适配 UI 布局：把分数锚到屏幕右上角，适配不同机型 ——
    private _onWindowResize = () => this._applyUILayout();
    private _applyUILayout(): void {
        if (!this._isAlive(this.uiCanvas)) return;

        // 取可见尺寸（编辑器/运行时都可靠），兜底用 screen.windowSize
        let w = 1080, h = 2340;
        try {
            const vs = view.getVisibleSize();
            if (vs && vs.width > 0 && vs.height > 0) {
                w = vs.width;
                h = vs.height;
            }
        } catch {}
        if ((!w || !h) && this.uiCanvas && this.uiCanvas.isValid) {
            const cvs = this.uiCanvas.getComponent(UITransform);
            if (cvs) { w = cvs.contentSize.width; h = cvs.contentSize.height; }
        }
        if (!w || !h) {
            w = screen?.windowSize?.width ?? 1080;
            h = screen?.windowSize?.height ?? 2340;
        }

        // 基于分辨率的缩放系数（旧设计基于 1080x2340）
        const baseW = 750;
        const baseH = 1334;
        const scale = Math.max(0.7, Math.min(0.95, Math.min(w / baseW, h / baseH)));

        // 自适应边距：随分辨率变化，防止 750x1334 下过于居中
        // 将主分数更贴近右上角，减少偏移
        const FIX_RIGHT_MARGIN = Math.max(36, Math.min(80, w * 0.06)); // 约 45px@750, 65px@1080
        const FIX_TOP_MARGIN   = Math.max(60, Math.min(120, h * 0.08)); // 约 107px@1334, 187px@2340

        // 右上角：主分数（锚点在右上），固定边距
        if (this.mainScoreLabelNode && this.mainScoreLabelNode.isValid) {
            const ui = this.mainScoreLabelNode.getComponent(UITransform) || this.mainScoreLabelNode.addComponent(UITransform);
            ui.setAnchorPoint(1, 1);
            this.mainScoreLabelNode.setPosition(w * 0.5 - FIX_RIGHT_MARGIN, h * 0.5 - FIX_TOP_MARGIN, 0);

            const lab = this.mainScoreLabelNode.getComponent(Label);
            if (lab) {
                lab.fontSize = Math.round(36 * scale);
                lab.lineHeight = Math.round(40 * scale);
            }
        }

        // 顶部中间略下：层数（保持原来的大致位置，但也采用固定距离，避免和主分数耦合）
        if (this.subLayerLabelNode && this.subLayerLabelNode.isValid) {
            const ui = this.subLayerLabelNode.getComponent(UITransform) || this.subLayerLabelNode.addComponent(UITransform);
            ui.setAnchorPoint(0.5, 1);
            // 固定从顶部向下约 18%~22% 高度，位置略微上移
            const fixedUpperY = h * Math.max(0.18, Math.min(0.22, 0.20 * scale + 0.01));
            this.subLayerLabelNode.setPosition(0, h * 0.5 - fixedUpperY, 0);

            const lab = this.subLayerLabelNode.getComponent(Label);
            if (lab) {
                lab.fontSize = Math.round(48 * scale);
                lab.lineHeight = Math.round(52 * scale);
            }
        }
    }

    // 确保存在 Canvas 与 UI 相机，并在其下创建两个 Label
    private _ensureCanvasAndLabels(): void {
        if (!this._isAlive(this.node)) return;
        // 1) 获取/创建 Canvas 根
        let canvas = director.getScene()?.getChildByName('Canvas');
        if (!canvas) {
            canvas = new Node('Canvas');
            canvas.layer = Layers.Enum.UI_2D;
            const c = canvas.addComponent(Canvas);
            c.alignCanvasWithScreen = true;
            director.getScene()?.addChild(canvas);
        }
        this.uiCanvas = canvas;

        // 2) 获取/创建 Canvas 下的 UI 相机（推荐结构：Canvas/UICamera）
        let uiCamNode = canvas.getChildByName('UICamera');
        let uiCam: Camera;
        if (!uiCamNode) {
            uiCamNode = new Node('UICamera');
            uiCamNode.layer = Layers.Enum.UI_2D;
            uiCam = uiCamNode.addComponent(Camera);
            canvas.addChild(uiCamNode);
        } else {
            uiCam = uiCamNode.getComponent(Camera) || uiCamNode.addComponent(Camera);
        }
        // 配置 UI 相机
        uiCam.projection = Camera.ProjectionType.ORTHO;
        uiCam.visibility = Layers.Enum.UI_2D;     // 只渲染 UI_2D 层
        uiCam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        uiCam.priority = 65535;                   // 始终最后渲染 UI
        // 让 Canvas 绑定到这台相机
        const canvasComp = canvas.getComponent(Canvas)!;
        canvasComp.cameraComponent = uiCam;

        // 3) 主分数 Label（大字）
        if (!this.mainScoreLabelNode || !this.mainScoreLabelNode.isValid) {
            const n = new Node('MainScoreLabel');
            n.layer = Layers.Enum.UI_2D;
            const ui = n.addComponent(UITransform);
            ui.setContentSize(300, 80);
            const lab = n.addComponent(Label);
            lab.string = '0';
            lab.fontSize = 70;
            lab.lineHeight = 56;
            lab.color = new Color(255,255,255,255);
            n.setPosition(0, 0, 0); // 初始为 (0,0,0)，布局由 _applyUILayout 控制
            canvas.addChild(n);
            this.mainScoreLabelNode = n;
            this._rememberBaseScale(this.mainScoreLabelNode);
        }

        // 4) 层数 Label（小字）
        if (!this.subLayerLabelNode || !this.subLayerLabelNode.isValid) {
            const n = new Node('SubLayerLabel');
            n.layer = Layers.Enum.UI_2D;
            const ui = n.addComponent(UITransform);
            ui.setContentSize(260, 60);
            const lab = n.addComponent(Label);
            lab.string = '0';
            lab.fontSize = 80;
            lab.lineHeight = 50;
            lab.color = new Color(255,255,255,220);
            n.setPosition(0, 0, 0); // 初始为 (0,0,0)，布局由 _applyUILayout 控制
            canvas.addChild(n);
            this.subLayerLabelNode = n;
            this._rememberBaseScale(this.subLayerLabelNode);
        }
        // 5) 连击徽章（仅在 combo>=2 时显示）
        if (!this.comboBadgeNode || !this.comboBadgeNode.isValid) {
            const n = new Node('ComboBadgeLabel');
            n.layer = Layers.Enum.UI_2D;
            const ui = n.addComponent(UITransform);
            ui.setContentSize(220, 70);
            const lab = n.addComponent(Label);
            lab.string = '';
            lab.fontSize = 40;
            lab.lineHeight = 44;
            lab.color = new Color(200, 255, 240, 255);
            // 使用 Label 的样式属性，避免旧组件属性弃用警告
            this._styleLabel(lab, {
                outlineColor: new Color(0, 60, 40, 255),
                outlineWidth: 2,
                shadowColor: new Color(0, 0, 0, 120),
                shadowOffset: new Vec2(1, -1),
                shadowBlur: 1,
            });
            n.setPosition(0, 400, 0);
            const op = n.addComponent(UIOpacity);
            op.opacity = 0;
            canvas.addChild(n);
            this.comboBadgeNode = n;
            this._rememberBaseScale(this.comboBadgeNode);
        }
        // 6) 交给 FriendRankView 统一创建/布局好友榜入口
        FriendRankView.ensureButton(canvas);
        // —— 自动适配布局 ——
        this._applyUILayout();
    }

    // 创建并显示开始遮罩 + 按钮（纯代码UI）
    private _ensureStartOverlay(): void {
        if (!this._isAlive(this.uiCanvas)) return;
        if (this.startOverlayNode && this.startOverlayNode.isValid) return;

        // 获取当前可见分辨率，用于缩放 UI
        let sw = 750, sh = 1334;
        try {
            const vs = view.getVisibleSize();
            if (vs && vs.width > 0 && vs.height > 0) { sw = vs.width; sh = vs.height; }
        } catch {}
        if ((!sw || !sh) && this.uiCanvas && this.uiCanvas.isValid) {
            const cvs = this.uiCanvas.getComponent(UITransform);
            if (cvs) { sw = cvs.contentSize.width; sh = cvs.contentSize.height; }
        }
        if (!sw || !sh) {
            sw = screen?.windowSize?.width ?? 750;
            sh = screen?.windowSize?.height ?? 1334;
        }
        const baseW = 750, baseH = 1334;
        // 收紧缩放范围，避免文字忽大忽小
        const uiScale = Math.max(0.65, Math.min(0.95, Math.min(sw / baseW, sh / baseH)));

        const n = new Node('StartOverlay');
        n.layer = Layers.Enum.UI_2D;
        // 给根节点加 UITransform 以参与 UI 事件命中与相机排序
        const nUI = n.addComponent(UITransform);
        nUI.setContentSize(sw, sh); // 用当前可见分辨率撑满
        const op = n.addComponent(UIOpacity);
        op.opacity = 0; // 先透明，稍后淡入
        n.setPosition(0, 0, 0);

        // 标题
        const title = new Node('Title');
        title.layer = Layers.Enum.UI_2D;
        const tUI = title.addComponent(UITransform);
        tUI.setContentSize(820 * uiScale, 200 * uiScale);
        const tLab = title.addComponent(Label);
        tLab.string = '方块堆堆高';
        tLab.fontSize = Math.round(50 * uiScale);
        tLab.lineHeight = Math.round(60 * uiScale);
        tLab.overflow = Label.Overflow.RESIZE_HEIGHT;
        tLab.color = new Color(255, 255, 255, 255);
        title.setPosition(0, sh * 0.12, 0);
        n.addChild(title);

        // “点击开始 / Press Space” 按钮（文字按钮）
        const btn = new Node('StartButton');
        btn.layer = Layers.Enum.UI_2D;
        const bUI = btn.addComponent(UITransform);
        bUI.setContentSize(540 * uiScale, 84 * uiScale);
        const bLab = btn.addComponent(Label);
        bLab.string = '点击开始';
        bLab.fontSize = Math.round(38 * uiScale);
        bLab.lineHeight = Math.round(46 * uiScale);
        bLab.color = new Color(180, 220, 255, 255); // 柔和蓝色，贴合背景且保持可读
        btn.setPosition(0, sh * 0.05, 0); // 上移靠近中心
        n.addChild(btn);

        // 防止点击按钮时也把事件传到全局 TOUCH_START（避免第一下就落块）
        btn.on(Input.EventType.TOUCH_START, (evt: any) => {
            evt?.stopPropagationImmediate?.();
            evt?.stopPropagation?.();
        }, this);
        btn.on(Input.EventType.MOUSE_DOWN, (evt: any) => {
            evt?.stopPropagationImmediate?.();
            evt?.stopPropagation?.();
        }, this);
        btn.on(Input.EventType.TOUCH_END, (evt: any) => {
            evt?.stopPropagationImmediate?.();
            evt?.stopPropagation?.();
            this._handleStartTap();
        }, this);
        btn.on(Input.EventType.MOUSE_UP, (evt: any) => {
            evt?.stopPropagationImmediate?.();
            evt?.stopPropagation?.();
            this._handleStartTap();
        }, this);

        // （可选）开始界面的排行榜：默认不显示
        if (this.showLeaderboardOnStart) {
            this._injectLeaderboard(n, -200);
        }

        this.uiCanvas.addChild(n);
        this.startOverlayNode = n;
        // 让好友榜按钮浮在遮罩之上，便于点击
        FriendRankView.bringButtonToFront(this.uiCanvas);

        // 淡入
        tween(op).to(0.18, { opacity: 255 }, { easing: 'quadOut' }).start();

        // 整个遮罩可点开始
        if (this.startOnTap) {
            n.on(Input.EventType.TOUCH_START, (evt: any) => {
                // 如果点在好友榜按钮上，则不处理开始
                if (this._isEventOnFriendRankUI(evt)) return;
                evt?.stopPropagationImmediate?.();
                evt?.stopPropagation?.();
                (evt as any)?.preventSwallow && ((evt as any).preventSwallow = false); // 兼容处理，无副作用
                this._handleStartTap();
            }, this);
            n.on(Input.EventType.MOUSE_DOWN, (evt: any) => {
                if (this._isEventOnFriendRankUI(evt)) return;
                evt?.stopPropagationImmediate?.();
                evt?.stopPropagation?.();
                this._handleStartTap();
            }, this);
        }
    }

    private _showStartOverlay(): void {
        this.isWaitingStart = true;
        this._ensureCanvasAndLabels();
        this._ensureStartOverlay();
        // 开局不显示连击徽章
        if (this.comboBadgeNode) {
            const op = this.comboBadgeNode.getComponent(UIOpacity) || this.comboBadgeNode.addComponent(UIOpacity);
            op.opacity = 0;
        }
    }

    private _handleStartTap(): void {
        if (!this.isWaitingStart) return;
        this._beginGameFromStartOverlay();
    }

    private _hideStartOverlay(): void {
        if (!this.startOverlayNode || !this.startOverlayNode.isValid) return;
        const op = this.startOverlayNode.getComponent(UIOpacity) || this.startOverlayNode.addComponent(UIOpacity);
        tween(op)
            .to(0.12, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => {
                if (this.startOverlayNode && this.startOverlayNode.isValid) {
                    this.startOverlayNode.removeFromParent();
                    this.startOverlayNode.destroy();
                    this.startOverlayNode = null;
                }
            })
            .start();
    }

    private _beginGameFromStartOverlay(): void {
        if (!this.isWaitingStart) return;
        this.isWaitingStart = false;
        this._hideStartOverlay();
        this._hideGameOverOverlay();
        this.spawnNextBlock();
        // 轻微提示
        if (this.mainScoreLabelNode) this._punchScale(this.mainScoreLabelNode, 0.10, 0.20);
    }

    // 重开：直接重载当前场景，状态全清，防止多次触发
    private _restartGame(): void {
        if (this._isSceneLoading) { return; }
        const sc = director.getScene();
        if (!sc) { return; }
        this._isSceneLoading = true;
        // 解绑全局输入，避免在加载过程中再次触发
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        // 使用回调在加载完成后清理标记
        director.loadScene(sc.name, () => {
            this._isSceneLoading = false;
        });
    }

    // 刷新两个 Label 的显示
    private _refreshScoreLabels(): void {
        if (!this._isAlive(this.node)) return;
        if (this._isAlive(this.mainScoreLabelNode)) {
            const lab = this.mainScoreLabelNode.getComponent(Label);
            if (lab && lab.isValid && this._isAlive(lab.node)) lab.string = String(this.points);
        }
        if (this._isAlive(this.subLayerLabelNode)) {
            const lab = this.subLayerLabelNode.getComponent(Label);
            if (lab && lab.isValid && this._isAlive(lab.node)) lab.string = String(this.score);
        }
    }

    // 在主分数附近显示 “+N” 飘字并淡出
    private _showFloatScore(gained: number, wasPerfect: boolean): void {
        if (!this._isAlive(this.uiCanvas) || !this._isAlive(this.node)) return;
        const n = new Node('ScoreFloat');
        n.layer = Layers.Enum.UI_2D;

        const ui = n.addComponent(UITransform);
        ui.setContentSize(160, 40);

        const lab = n.addComponent(Label);
        lab.string = `+${gained}`;
        lab.fontSize = 32;
        lab.lineHeight = 36;
        if (wasPerfect) {
            lab.color = new Color(255, 235, 160, 255); // 淡金色
        } else {
            lab.color = new Color(255, 255, 255, 255);
        }

        // 使用 Label 的新样式属性，兼容 3.8+，不再访问已弃用的组件属性
        this._styleLabel(lab, {
            outlineColor: wasPerfect ? new Color(120, 80, 0, 255) : new Color(0, 0, 0, 255),
            outlineWidth: 2,
            shadowColor: wasPerfect ? new Color(255, 235, 160, 120) : new Color(0, 0, 0, 120),
            shadowOffset: new Vec2(1, -1),
            shadowBlur: wasPerfect ? 2 : 1,
        });

        const op = n.addComponent(UIOpacity);
        op.opacity = 255;

        // —— 随机化：起点偏移 / 初始缩放 / 上飘高度 ——
        const basePos = this._isAlive(this.mainScoreLabelNode) ? this.mainScoreLabelNode.position.clone() : new Vec3(0, 300, 0);
        const jitterX = (Math.random() * 12 - 6);   // ±6 px
        const jitterY = (Math.random() * 8 - 4);    // ±4 px
        const start = new Vec3(basePos.x + jitterX, basePos.y + jitterY, basePos.z);

        const baseScale = wasPerfect ? 1.08 : 1.0;
        const randScale = baseScale * (0.95 + Math.random() * 0.13); // 0.95~1.08
        n.setScale(randScale, randScale, 1);

        n.setPosition(start);
        this.uiCanvas.addChild(n);

        const floatHeight = 60 + (Math.random() * 16 - 8); // 60 ±8 px
        const endPos = new Vec3(start.x, start.y + floatHeight, start.z);

        // —— 动画：上飘 + 渐隐 + 轻微弹性缩放 ——
        tween(n)
            .to(0.6, { position: endPos }, { easing: 'quadOut' })
            .start();

        tween(op)
            .delay(0.18)
            .to(0.42, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => { if (n && n.isValid) { n.removeFromParent(); n.destroy(); } })
            .start();

        // 轻微弹性（从当前随机 scale 先略放大再回落）
        const s = n.scale.clone();
        const up = new Vec3(s.x * 1.06, s.y * 1.06, 1);
        tween(n)
            .to(0.12, { scale: up }, { easing: 'quadOut' })
            .to(0.14, { scale: s }, { easing: 'quadIn' })
            .start();
    }

    private _updateComboBadge(): void {
        if (!this._isAlive(this.uiCanvas)) return;
        if (!this.comboBadgeNode || !this.comboBadgeNode.isValid) return;
        const combo = this.comboCount;
        const op = this.comboBadgeNode.getComponent(UIOpacity) || this.comboBadgeNode.addComponent(UIOpacity);
        const lab = this.comboBadgeNode.getComponent(Label);
        if (!lab) return;
        if (combo < 2) {
            tween(op).stop();
            op.opacity = 0;
            return;
        }
        lab.string = `x${combo}`;
        if (combo <= 3) {
            lab.color = new Color(160, 255, 220, 255);
        } else if (combo <= 5) {
            lab.color = new Color(255, 220, 160, 255);
        } else {
            lab.color = new Color(255, 170, 220, 255);
        }
        tween(op).stop();
        tween(op).to(0.12, { opacity: 255 }, { easing: 'quadOut' }).start();
        this._punchScale(this.comboBadgeNode, 0.12, 0.22);
    }

    private _hideComboBadge(): void {
        if (!this.comboBadgeNode || !this.comboBadgeNode.isValid) return;
        const op = this.comboBadgeNode.getComponent(UIOpacity) || this.comboBadgeNode.addComponent(UIOpacity);
        tween(op).stop();
        tween(op).to(0.1, { opacity: 0 }, { easing: 'quadIn' }).start();
    }

    private _flashBlockStrong(target: Node, combo: number) {
        if (!target || !target.isValid) return;
        const mr = target.getComponent(MeshRenderer);
        if (!mr) return;
        const mat = mr.getMaterialInstance(0);
        if (!mat) return;
        const cur = this._getMatColor(mat) ?? new Color(255,255,255,255);
        const anim = new Color(cur);
        const factor = Math.min(1.6, 1.35 + combo * 0.03);
        const bright = new Color(
            Math.min(255, Math.round(cur.r * factor)),
            Math.min(255, Math.round(cur.g * factor)),
            Math.min(255, Math.round(cur.b * factor)),
            cur.a
        );
        tween(anim)
            .to(0.06, { r: bright.r, g: bright.g, b: bright.b, a: bright.a }, { onUpdate: () => this._setMatColor(mat, anim) })
            .to(0.12, { r: cur.r, g: cur.g, b: cur.b, a: cur.a }, { onUpdate: () => this._setMatColor(mat, anim) })
            .start();
    }

    // 结算本次放置的得分（完美/连击奖励）
    private _addPointsForPlacement(wasPerfect: boolean): void {
        let gained = this.pointsPerLayer;
        if (wasPerfect) {
            const streak = Math.max(0, this.comboCount - 1); // 从第二次完美开始叠加
            gained += this.perfectBonus + streak * this.streakBonus;
        }
        this.points += gained;
        // 主分数轻微跳动 + 飘字
        if (this.mainScoreLabelNode) {
            if (wasPerfect) {
                this._punchScale(this.mainScoreLabelNode, 0.16, 0.25);
            } else {
                this._punchScale(this.mainScoreLabelNode, 0.12, 0.22);
            }
        }
        this._showFloatScore(gained, wasPerfect);
        if (this.debugLogScores) {
            console.log(`[Score] +${gained} ${wasPerfect ? '(perfect' + (this.comboCount > 1 ? ` x${this.comboCount}` : '') + ')' : ''}  => points=${this.points}  layers=${this.score}`);
        }
        this._refreshScoreLabels();
    }

    // 连续完美成长：当 comboCount 达到 streakGrowEvery 的倍数时，放大顶部方块的 X/Z
    private _maybeStreakGrowTop(): void {
        if (!this.baseBlock || !this.baseBlock.isValid) return;
        if (this.streakGrowEvery <= 0) return;
        if (this.comboCount < this.streakGrowEvery) return;
        if (this.comboCount % this.streakGrowEvery !== 0) return; // 仅在 7、14、21… 次触发

        const cur = this.baseBlock.scale.clone();
        const targetX = Math.min(this._baseMaxX || cur.x, cur.x * this.streakGrowFactor);
        const targetZ = Math.min(this._baseMaxZ || cur.z, cur.z * this.streakGrowFactor);
        const target = new Vec3(targetX, cur.y, targetZ);

        // 逻辑上需要立刻生效，确保下一块使用放大后的尺寸
        this.baseBlock.setScale(target);

        // 视觉强调：轻微“呼吸”不改变最终尺寸
        const up = new Vec3(target.x * 1.05, target.y, target.z * 1.05);
        tween(this.baseBlock)
            .to(0.08, { scale: up }, { easing: 'quadOut' })
            .to(0.08, { scale: target }, { easing: 'quadIn' })
            .start();

        // 轻微相机强调（可选，非常小幅）
        this._cameraShake(0.03, 0.12);
    }

    getBlockColorByLevel(level: number): Color {
        // 1) 仍然使用“递增色相”
        const hue = (this.baseHueOffset + level * this.hueStep) % 360;

        // 2) 好看曲线（smoothstep + 正弦）——让 S/L 随 hue 平滑摆动
        const hRad = hue * Math.PI / 180;
        const smooth = (x: number) => x * x * (3 - 2 * x);
        const t = smooth((Math.sin(hRad * 0.7 + 0.6) * 0.5 + 0.5)); // 0..1

        let s = this.satBase + this.satVar * (t * 2 - 1);              // satBase ± satVar
        let l = this.lightBase + this.lightVar * (Math.sin(hRad + 1));  // lightBase ± lightVar

        // 3) 颜色卫生修正：对“易脏”区段做温和微调（不破坏递增风格）
        if (hue >= 90 && hue < 150) { s *= 0.92; l += 0.03; }   // 绿色：降饱和、提亮一点
        if (hue >= 210 && hue < 260) { l += 0.04; }             // 靛青：提亮避免发闷
        if (hue >= 340 || hue < 20)   { s = Math.min(s, 0.60); } // 纯红品红：限制饱和避免刺眼

        // 4) 随层整体轻微变亮（让后期更通透）
        l += this.levelBrighten * Math.min(level, 80); // 上限避免过度

        // 5) HSL → RGB（内联，无外部依赖）
        s = Math.max(0, Math.min(1, s));
        l = Math.max(0, Math.min(1, l));
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (hue < 60)      { r = c; g = x; b = 0; }
        else if (hue < 120){ r = x; g = c; b = 0; }
        else if (hue < 180){ r = 0; g = c; b = x; }
        else if (hue < 240){ r = 0; g = x; b = c; }
        else if (hue < 300){ r = x; g = 0; b = c; }
        else               { r = c; g = 0; b = x; }

        return new Color((r + m) * 255, (g + m) * 255, (b + m) * 255, 255);
    }





    private _getMatColor(mat: Material): Color | null {
        const baseKeys = ['albedo', 'mainColor', 'baseColor', 'u_color', 'color', 'albedoColor', 'baseColorFactor', 'emissive', 'emissiveColor'];
        const keys = this._matColorKey ? [this._matColorKey, ...baseKeys] : baseKeys;
        const seen = new Set<string>();
        for (const k of keys) {
            if (seen.has(k)) continue; seen.add(k);
            try {
                const v: any = (mat as any).getProperty?.(k);
                if (v === undefined || v === null) continue;
                if (v instanceof Color) return v.clone();
                if (Array.isArray(v) && v.length >= 3) {
                    const [r, g, b, a = 1] = v;
                    return new Color(r * 255, g * 255, b * 255, a * 255);
                }
                if (typeof v === 'object' && 'x' in v && 'y' in v && 'z' in v) {
                    const a = 'w' in v ? (v as any).w : 1;
                    return new Color((v as any).x * 255, (v as any).y * 255, (v as any).z * 255, a * 255);
                }
            } catch {}
        }
        return null;
    }

    private _setMatColor(mat: Material, color: Color): void {
        const baseKeys = ['albedo', 'mainColor', 'baseColor', 'u_color', 'color', 'albedoColor', 'baseColorFactor', 'emissive', 'emissiveColor'];
        const keys = this._matColorKey ? [this._matColorKey, ...baseKeys] : baseKeys;
        const seen = new Set<string>();
        const toVec4 = [color.r / 255, color.g / 255, color.b / 255, color.a / 255];
        for (const k of keys) {
            if (seen.has(k)) continue; seen.add(k);
            try {
                const cur = (mat as any).getProperty?.(k);
                if (cur === undefined) continue;
                // 先尝试直接写 Color
                try { (mat as any).setProperty?.(k, color); this._matColorKey = k; return; } catch {}
                // 再尝试写 Vec4/数组（很多内置 effect 用 vec4）
                try { (mat as any).setProperty?.(k, toVec4 as any); this._matColorKey = k; return; } catch {}
            } catch {}
        }
    }

    // 保证背景板一定可见：放到相机前方、面向相机、扩大尺寸、降低渲染优先级
    private _ensureBackgroundVisible(): void {
        const bg = this.backgroundPlane ?? this.node.parent?.getChildByName('BackgroundPlane');
        const cam = this.cameraNode;
        if (!bg || !cam) return;

        // 让背景板跟随相机，始终在相机前方
        if (bg.parent !== cam) {
            bg.removeFromParent();
            cam.addChild(bg);
        }
        // 注意：相机默认朝向 -Z，因此前方应为本地 -Z
        bg.setPosition(0, 0, -130);
        // 与相机同向，保证正面朝向镜头
        bg.setRotation(cam.rotation);
        // 放大到覆盖画面
        bg.setScale(9000, 1, 9000);

        // 优先绘制（或最后绘制均可），这里取较小的优先级，避免遮挡其他物体
        const mr = bg.getComponent(MeshRenderer);
        if (mr) {
            mr.priority = -1000; // 极低优先级，先画背景
        }
    }
    
    // 旧方案：背景颜色 = base block 颜色（直接写材质颜色属性）
    private _setBackgroundToBaseColor(color: Color): void {
        const bg = this.backgroundPlane ?? this.node.parent?.getChildByName('BackgroundPlane');
        if (!bg) return;
        const mr = bg.getComponent(MeshRenderer);
        if (!mr) return;
        const mat = mr.getMaterialInstance(0);
        if (!mat) return;
        const adj = this._adjustForBackground(color.clone());
        this._setMatColor(mat, adj);
    }

    // —— 背景色微调工具：把方块色转为更通透的背景色（提亮≈12%，降饱和≈12%） ——
    private _colorToHsl(c: Color): { h: number; s: number; l: number } {
        const r = c.r / 255, g = c.g / 255, b = c.b / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        const d = max - min;
        if (d !== 0) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h *= 60;
        }
        return { h, s, l };
    }

    private _hslToColor(h: number, s: number, l: number): Color {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 60)      { r = c; g = x; b = 0; }
        else if (h < 120){ r = x; g = c; b = 0; }
        else if (h < 180){ r = 0; g = c; b = x; }
        else if (h < 240){ r = 0; g = x; b = c; }
        else if (h < 300){ r = x; g = 0; b = c; }
        else             { r = c; g = 0; b = x; }
        return new Color((r + m) * 255, (g + m) * 255, (b + m) * 255, 255);
    }

    private _adjustForBackground(src: Color): Color {
        const { h, s, l } = this._colorToHsl(src);
        // 基础：整体轻度降饱和、按明度自适应提亮
        let s2 = s * 0.88;
        let l2 = l + 0.12 * (1 - l);

        // 分段微调：避免脏绿/闷靛/刺红
        if (h >= 90 && h < 150) { // 绿区
            s2 *= 0.92; // 更干净
            l2 += 0.03; // 微提亮
        }
        if (h >= 210 && h < 260) { // 靛青区
            l2 += 0.04; // 防闷
        }
        if (h >= 340 || h < 20) { // 红/品红区
            s2 = Math.min(s2, 0.60); // 限制饱和避免刺眼
        }

        s2 = Math.max(0, Math.min(1, s2));
        l2 = Math.max(0, Math.min(1, l2));
        return this._hslToColor(h, s2, l2);
    }

    // 平滑过渡背景颜色
    private _tweenBackgroundColor(target: Color, duration: number = 0.4): void {
        const bg = this.backgroundPlane ?? this.node.parent?.getChildByName('BackgroundPlane');
        if (!bg) return;
        const mr = bg.getComponent(MeshRenderer);
        if (!mr) return;
        const mat = mr.getMaterialInstance(0);
        if (!mat) return;

        const current = this._getMatColor(mat) ?? new Color(255, 255, 255, 255);
        const targetAdj = this._adjustForBackground(target.clone());
        const anim = new Color(current);
        tween(anim)
            .to(duration, { r: targetAdj.r, g: targetAdj.g, b: targetAdj.b, a: targetAdj.a }, {
                onUpdate: () => this._setMatColor(mat, anim)
            })
            .start();
    }

    // 初始化并播放背景音乐（独立 AudioSource，避免与音效冲突）
    private _initBGM(): void {
        if (!this.bgmClip) return;
        // 创建/获取子节点 BGM
        let bgmNode = this.node.getChildByName('BGM');
        if (!bgmNode) {
            bgmNode = new Node('BGM');
            this.node.addChild(bgmNode);
        }
        let src = bgmNode.getComponent(AudioSource);
        if (!src) src = bgmNode.addComponent(AudioSource);
        src.clip = this.bgmClip;
        src.loop = true;
        src.volume = 0; // 淡入从 0 开始
        src.play();
        this.bgmSource = src;

        // 淡入到目标音量
        const vol = { v: 0 };
        tween(vol)
            .to(this.bgmFadeIn, { v: this.bgmVolume }, {
                onUpdate: () => {
                    if (this.bgmSource && this.bgmSource.isValid) {
                        this.bgmSource.volume = vol.v;
                    }
                }
            })
            .start();
    }

    start() {
        // 复活状态初始化
        this._reviveCount = 0;
        this._reviveRequesting = false;
        this._gameOverFinalized = false;
        this._reviveOverlayNode = null;

        // 随机化 baseHueOffset，每次开局随机色系
        this.baseHueOffset = Math.floor(Math.random() * 36) * 10;

        // Create base block
        this.baseBlock = instantiate(this.blockPrefab);
        this.baseBlock.setPosition(new Vec3(0, -2.5, 0));
        // 依据 initialBlockScale 缩小初始底座的 X/Z，避免在真机窄屏上露出画面外
        const rawScale = this.baseBlock.scale.clone();
        const s = this._calcInitialBlockScale();
        const scaled = new Vec3(rawScale.x * s, rawScale.y, rawScale.z * s);
        this.baseBlock.setScale(scaled);
        // 同步高度/上限（供相机与后续新块参考）
        this.baseBlockHeight = scaled.y;
        this._baseMaxX = scaled.x;
        this._baseMaxZ = scaled.z;
        this.node.addChild(this.baseBlock);

        // 设置 base block 的颜色
        const baseColor = this.getBlockColorByLevel(0); // 基础层级色：以 baseHueOffset 为全局偏移，不再重复相加
        const baseMeshRenderer = this.baseBlock.getComponent(MeshRenderer);
        if (baseMeshRenderer) {
            const baseMat = baseMeshRenderer.getMaterialInstance(0);
            this._setMatColor(baseMat, baseColor);
        }

        this._setBackgroundToBaseColor(baseColor); // 背景=base block 同色（旧方案）
        this._ensureBackgroundVisible();
        // 解决浏览器自动播放策略：等用户首次交互后再启动 BGM
        this._bindUserGestureForBGM();

        // 记录编辑器里的相机初始位置，后续抬升只改 Y，避免覆盖你的 X/Z 设置
        if (this.cameraNode) {
            this._cameraBasePos = this.cameraNode.position.clone();
            this._cameraBaseEuler = this.cameraNode.eulerAngles.clone();
            const camComp = this.cameraNode.getComponent(Camera);
            if (camComp) {
                this._cameraBaseOrtho = camComp.orthoHeight;
            }
        }

        // 初始化 UI 与分数
        this.points = 0;
        this.score = 0;
        this._ensureCanvasAndLabels();
        this._refreshScoreLabels();
        this._showStartOverlay(); // 开局等待开始
        if (this.debugLogScores) {
            console.log(`[Start] points=${this.points}  layers=${this.score}  moveSpeed=${this.moveSpeed}`);
        }
        // —— 响应窗口尺寸变化，自动自适应 UI 布局 ——
        this._applyUILayout();
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('resize', this._onWindowResize);
        }

        // 微信小游戏前后台切换：暂停/恢复 BGM 与游戏逻辑
        if (sys.platform === sys.Platform.WECHAT_GAME) {
            const wxAny: any = (window as any).wx;
            wxAny?.onHide?.(() => {
                if (!this.isValid) return;
                this.bgmSource?.pause();
                director.pause();
            });
            wxAny?.onShow?.(() => {
                if (!this.isValid) return;
                director.resume();
                if (this._bgmStarted && this.bgmSource?.isValid) {
                    this.bgmSource.play();
                }
            });
            this._initWechatShare();
            this._ensureRewardedAd();
        }

        // Spawn the first moving block using unified logic

        // 摄像头位置保持在编辑器中设置的初始值，不在此处重设

        // Add event listener for user input
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        // Add event listener for keyboard input (C key to simulate perfect stack)
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
    }

    onDisable() {
        // 停止定时器和 UI 动画，避免在节点被禁用/销毁后继续触发微信原生视图
        this.unscheduleAllCallbacks();
        const toStop = [this.node, this.uiCanvas, this.startOverlayNode, this.gameOverOverlayNode, this._reviveOverlayNode, this.comboBadgeNode];
        toStop.forEach(n => { if (n && n.isValid) Tween.stopAllByTarget(n); });
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        try { if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', this._onWindowResize); } catch {}
        if (this.bgmSource && this.bgmSource.isValid) {
            this.bgmSource.stop();
        }
        this.onDisable();
        const toDispose = [this.startOverlayNode, this.gameOverOverlayNode, this._reviveOverlayNode];
        toDispose.forEach(n => {
            if (n && n.isValid) {
                n.removeFromParent();
                n.destroy();
            }
        });
        this.startOverlayNode = null;
        this.gameOverOverlayNode = null;
        this._reviveOverlayNode = null;
        this._leaderboardViews = [];
    }

    // ===== Leaderboard (UI helpers) =====
    private _readLeaderboard(): LeaderboardEntry[] {
        try {
            const raw = sys.localStorage.getItem(LB_KEY);
            const list = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(list)) return [];
            return list
                .filter(e => e && typeof e.points==='number' && typeof e.layers==='number' && typeof e.date==='number')
                .sort((a,b)=> (b.points-a.points) || (b.layers-a.layers) || (b.date-a.date))
                .slice(0, 10);
        } catch { return []; }
    }

    private _updateLeaderboardRows(rows: LeaderboardRowRefs[], data: LeaderboardEntry[]): void {
        for (let i = 0; i < rows.length; i++) {
            const refs = rows[i];
            if (!refs) continue;
            // 任一标签无效则跳过，防止销毁后的节点被更新
            if (!this._isAlive(refs.rankLabel?.node) || !this._isAlive(refs.pointsLabel?.node) || !this._isAlive(refs.layersLabel?.node)) {
                continue;
            }
            const entry = data[i];
            refs.rankLabel.string = `${i + 1}.`;
            if (!entry) {
                refs.pointsLabel.string = '--';
                refs.layersLabel.string = '--';
                refs.pointsLabel.color = new Color(200, 200, 200, 160);
                refs.layersLabel.color = new Color(200, 200, 200, 160);
                if (refs.crownNode && this._isAlive(refs.crownNode)) refs.crownNode.active = false;
                continue;
            }
            refs.pointsLabel.string = String(entry.points);
            refs.layersLabel.string = String(entry.layers);
            refs.pointsLabel.color = new Color(255, 255, 255, 255);
            refs.layersLabel.color = new Color(255, 255, 255, 220);
            if (refs.crownNode && this._isAlive(refs.crownNode)) refs.crownNode.active = i === 0;
        }
    }

    private _registerLeaderboardView(root: Node, rows: LeaderboardRowRefs[]): void {
        if (!this._isAlive(root)) return;
        this._leaderboardViews = this._leaderboardViews.filter(view => view.root && view.root.isValid);
        const existing = this._leaderboardViews.find(view => view.root === root);
        if (existing) {
            existing.rows = rows;
        } else {
            this._leaderboardViews.push({ root, rows });
        }
    }

    private _refreshLeaderboardViews(): void {
        const data = this._readLeaderboard();
        this._leaderboardViews = this._leaderboardViews.filter(view => view.root && view.root.isValid);
        for (const view of this._leaderboardViews) {
            if (!view.rows || !view.rows.length || !this._isAlive(view.root)) continue;
            this._updateLeaderboardRows(view.rows, data);
        }
    }

    // 将成绩写入微信关系链存储，供开放数据域好友榜读取；非微信环境直接跳过
    private _syncWxFriendStorage(): void {
        if (typeof wx === 'undefined') return;
        const pts = Math.max(0, Math.floor(this.points));
        const layers = Math.max(0, Math.floor(this.score));
        try {
            wx.setUserCloudStorage({
                KVDataList: [
                    { key: 'points', value: String(pts) },
                    { key: 'layers', value: String(layers) },
                ],
                success: () => {
                    if (this.debugLogScores) {
                        console.log('[StackGame] setUserCloudStorage ok', pts, layers);
                    }
                },
                fail: (err: any) => {
                    if (this.debugLogScores) {
                        console.warn('[StackGame] setUserCloudStorage failed', err);
                    }
                },
            });
        } catch (err) {
            if (this.debugLogScores) {
                console.warn('[StackGame] setUserCloudStorage threw', err);
            }
        }
    }

    private _appendLocalLeaderboard(points: number, layers: number): void {
        try {
            const raw = sys.localStorage.getItem(LB_KEY);
            const list: LeaderboardEntry[] = raw ? JSON.parse(raw) : [];
            const nickname = this._profileCache?.nickName?.trim() || '本地玩家';
            const avatarUrl = this._profileCache?.avatarUrl || '';
            const entry: LeaderboardEntry = {
                points: Math.max(0, Math.floor(points)),
                layers: Math.max(0, Math.floor(layers)),
                date: Date.now(),
                nickname,
                avatarUrl,
            };
            if (Array.isArray(list)) {
                list.push(entry);
                list.sort((a, b) => (b.points - a.points) || (b.layers - a.layers) || (b.date - a.date));
                sys.localStorage.setItem(LB_KEY, JSON.stringify(list.slice(0, 20)));
            } else {
                sys.localStorage.setItem(LB_KEY, JSON.stringify([entry]));
            }
        } catch (err) {
            if (this.debugLogScores) {
                console.warn('[StackGame] save local leaderboard failed', err);
            }
        }
        this._refreshLeaderboardViews();
    }

    private async _ensureUserProfile(): Promise<{ nickName: string; avatarUrl: string } | null> {
        if (this._profileCache) return this._profileCache;
        const wxAny: any =
          (typeof window !== 'undefined' ? (window as any).wx : undefined) ||
          (typeof wx !== 'undefined' ? wx : undefined);
        if (!wxAny?.getUserProfile) return null;
        try {
            const profile = await new Promise<{ nickName: string; avatarUrl: string }>((resolve, reject) => {
                wxAny.getUserProfile({
                    desc: '用于展示排行榜',
                    success: (res: any) => resolve({
                        nickName: res?.userInfo?.nickName ?? '',
                        avatarUrl: res?.userInfo?.avatarUrl ?? '',
                    }),
                    fail: reject,
                });
            });
            this._profileCache = profile;
            return profile;
        } catch (err) {
            console.warn('[StackGame] getUserProfile failed', err);
            return null;
        }
    }

    private _injectLeaderboard(root: Node, startY: number = -220, scale: number = 1): void {
        if (!root || !root.isValid) return;
        const old = root.getChildByName('Leaderboard');
        if (old) old.destroy();

        const s = Math.max(0.7, Math.min(1.1, scale));
        const listNode = new Node('Leaderboard');
        listNode.layer = Layers.Enum.UI_2D;
        const ui = listNode.addComponent(UITransform);
        ui.setContentSize(900 * s, 420 * s);
        listNode.setPosition(0, startY, 0);
        root.addChild(listNode);
        listNode.setScale(1.0 * s, 1.0 * s, 1);

        const title = new Node('LBTitle');
        title.layer = Layers.Enum.UI_2D;
        title.addComponent(UITransform).setContentSize(800 * s, 40 * s);
        const titleLab = title.addComponent(Label);
        titleLab.string = '本地排行榜';
        titleLab.fontSize = Math.round(40 * s);
        titleLab.lineHeight = Math.round(46 * s);
        titleLab.color = new Color(255, 255, 255, 235);
        title.setPosition(0, 180 * s, 0);
        listNode.addChild(title);

        const colRankX = -110 * s;
        const colScoreX = 0;
        const colLayerX = 110 * s;
        const rowH = 34 * s;
        const rows: LeaderboardRowRefs[] = [];

        for (let i = 0; i < 10; i++) {
            const row = new Node(`Row${i + 1}`);
            row.layer = Layers.Enum.UI_2D;
            row.addComponent(UITransform).setContentSize(860 * s, rowH);
            row.setPosition(0, 95 * s - i * rowH, 0);
            listNode.addChild(row);

            const isTop3 = i < 3;
            const fontSize = isTop3 ? Math.round(30 * s) : Math.round(24 * s);
            const lineHeight = isTop3 ? Math.round(34 * s) : Math.round(30 * s);

            const rankNode = new Node('Rank');
            rankNode.layer = Layers.Enum.UI_2D;
            rankNode.addComponent(UITransform).setContentSize(200 * s, rowH);
            const rankLab = rankNode.addComponent(Label);
            rankLab.fontSize = fontSize;
            rankLab.lineHeight = lineHeight;
            (rankLab as any).horizontalAlign = 2;
            rankNode.setPosition(colRankX, 0, 0);
            row.addChild(rankNode);

            const ptsNode = new Node('Points');
            ptsNode.layer = Layers.Enum.UI_2D;
            ptsNode.addComponent(UITransform).setContentSize(220 * s, rowH);
            const ptsLab = ptsNode.addComponent(Label);
            ptsLab.fontSize = fontSize;
            ptsLab.lineHeight = lineHeight;
            (ptsLab as any).horizontalAlign = 2;
            ptsNode.setPosition(colScoreX, 0, 0);
            row.addChild(ptsNode);

            let crownNode: Node | undefined;
            if (i === 0) {
                crownNode = new Node('Crown');
                crownNode.layer = Layers.Enum.UI_2D;
                crownNode.addComponent(UITransform).setContentSize(36 * s, 22 * s);
                const crownLab = crownNode.addComponent(Label);
                crownLab.string = '👑';
                crownLab.fontSize = Math.round(22 * s);
                crownLab.lineHeight = lineHeight;
                crownLab.color = new Color(255, 215, 0, 255);
                crownNode.setPosition(colScoreX + 130 * s, rowH * 0.1, 0);
                row.addChild(crownNode);
            }

            const layerNode = new Node('Layers');
            layerNode.layer = Layers.Enum.UI_2D;
            layerNode.addComponent(UITransform).setContentSize(220 * s, rowH);
            const layerLab = layerNode.addComponent(Label);
            layerLab.fontSize = fontSize;
            layerLab.lineHeight = lineHeight;
            (layerLab as any).horizontalAlign = 2;
            layerNode.setPosition(colLayerX, 0, 0);
            row.addChild(layerNode);

            rows.push({ rankLabel: rankLab, pointsLabel: ptsLab, layersLabel: layerLab, crownNode });
        }

        this._registerLeaderboardView(root, rows);
        this._updateLeaderboardRows(rows, this._readLeaderboard());
    }

    // —— 复活 & 激励视频 —— 
    private _getWx(): any {
        if (typeof wx !== 'undefined') return wx as any;
        if (typeof window !== 'undefined') return (window as any).wx;
        return undefined;
    }

    private _initWechatShare(): void {
        if (sys.platform !== sys.Platform.WECHAT_GAME) return;
        const wxAny = this._getWx();
        if (!wxAny?.showShareMenu) return;
        try {
            // 打开转发和朋友圈入口。复制链接能力当前由平台控制，小游戏只能使用官方菜单。
            wxAny.showShareMenu({
                withShareTicket: true,
                menus: ['shareAppMessage', 'shareTimeline']
            });
            const payload = () => ({
                title: this.shareTitle || '方块堆堆高',
                imageUrl: this.shareImageUrl || undefined,
                query: this.shareQuery || ''
            });
            wxAny.onShareAppMessage?.(() => payload());
            wxAny.onShareTimeline?.(() => payload());
        } catch (err) {
            console.warn('[Share] init share failed', err);
        }
    }

    private _ensureRewardedAd(): void {
        if (!this.enableReviveAd) return;
        if (this._rewardedAd) return;
        if (!this.reviveAdUnitId) return;
        if (sys.platform !== sys.Platform.WECHAT_GAME) return;
        const wxAny = this._getWx();
        if (!wxAny?.createRewardedVideoAd) return;
        try {
            const ad = wxAny.createRewardedVideoAd({ adUnitId: this.reviveAdUnitId });
            ad.onError?.((err: any) => {
                console.warn('[ReviveAd] create/load error', err);
            });
            this._rewardedAd = ad;
        } catch (err) {
            console.warn('[ReviveAd] createRewardedVideoAd failed', err);
        }
    }

    private _canOfferRevive(): boolean {
        if (!this.enableReviveAd) return false;
        if (this._reviveCount >= this.reviveMaxTimes) return false;
        if (this._gameOverFinalized) return false;
        if (sys.platform === sys.Platform.WECHAT_GAME) {
            this._ensureRewardedAd();
            return !!(this.reviveAdUnitId && this._rewardedAd);
        }
        return this.mockReviveInEditor; // 非微信环境：仅用于编辑器/浏览器调试
    }

    private _showRewardedVideoAd(): Promise<boolean> {
        // 编辑器/浏览器环境：直接模拟成功，方便联调
        if (sys.platform !== sys.Platform.WECHAT_GAME) {
            return new Promise((resolve) => {
                this.scheduleOnce(() => {
                    if (!this.isValid) { resolve(false); return; }
                    resolve(true);
                }, 0.3);
            });
        }
        return new Promise((resolve) => {
            const ad = this._rewardedAd;
            if (!ad) {
                resolve(false);
                return;
            }
            const cleanup = () => {
                ad.offClose?.(onClose);
                ad.offError?.(onError);
            };
            const onClose = (res: any) => {
                cleanup();
                const completed = res?.isEnded !== false;
                resolve(completed);
            };
            const onError = (err: any) => {
                console.warn('[ReviveAd] show error', err);
                cleanup();
                resolve(false);
            };
            ad.onClose?.(onClose);
            ad.onError?.(onError);
            ad.show?.().catch(() => {
                ad.load?.().then(() => ad.show?.().catch(onError)).catch(onError);
            });
        });
    }

    private _hideReviveOverlay(): void {
        if (!this._reviveOverlayNode || !this._reviveOverlayNode.isValid) return;
        const op = this._reviveOverlayNode.getComponent(UIOpacity) || this._reviveOverlayNode.addComponent(UIOpacity);
        tween(op)
            .to(0.12, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => {
                if (this._reviveOverlayNode && this._reviveOverlayNode.isValid) {
                    this._reviveOverlayNode.removeFromParent();
                    this._reviveOverlayNode.destroy();
                    this._reviveOverlayNode = null;
                }
            })
            .start();
    }

    private _showReviveOverlay(): void {
        if (!this._canOfferRevive()) {
            this._finalizeGameOver();
            return;
        }
        this._ensureCanvasAndLabels();
        if (!this._isAlive(this.uiCanvas)) return;
        if (this._reviveOverlayNode && this._reviveOverlayNode.isValid) return;

        const n = new Node('ReviveOverlay');
        n.layer = Layers.Enum.UI_2D;
        const ui = n.addComponent(UITransform);
        // 适配当前分辨率
        let sw = 750, sh = 1334;
        try {
            const vs = view.getVisibleSize();
            if (vs && vs.width > 0 && vs.height > 0) { sw = vs.width; sh = vs.height; }
        } catch {}
        if (!sw || !sh) {
            sw = screen?.windowSize?.width ?? 750;
            sh = screen?.windowSize?.height ?? 1334;
        }
        const baseW = 750, baseH = 1334;
        const uiScale = Math.max(0.55, Math.min(1.05, Math.min(sw / baseW, sh / baseH)));

        // —— Revive overlay layout (unified vertical rhythm) ——
        const groupY = sh * 0.03;              // 整组略上，保证整体居中偏上
        const gapWatchSkip = 60 * uiScale;     // 主-次按钮间距
        const watchY = groupY + 120 * uiScale; // 主按钮基准
        const skipY  = watchY - (40 * uiScale) - gapWatchSkip;

        ui.setContentSize(sw, sh);
        const op = n.addComponent(UIOpacity);
        op.opacity = 0;
        n.setPosition(0, 0, 0);

        const btnWatch = new Node('WatchAd');
        btnWatch.layer = Layers.Enum.UI_2D;
        btnWatch.addComponent(UITransform).setContentSize(720 * uiScale, 90 * uiScale);
        const wLab = btnWatch.addComponent(Label);
        wLab.string = '观看广告并复活';
        wLab.fontSize = Math.round(32 * uiScale);
        wLab.lineHeight = Math.round(40 * uiScale);
        wLab.color = new Color(120, 255, 210, 255); // 清新的薄荷绿
        btnWatch.setPosition(0, watchY, 0);
        n.addChild(btnWatch);

        const btnSkip = new Node('GiveUp');
        btnSkip.layer = Layers.Enum.UI_2D;
        btnSkip.addComponent(UITransform).setContentSize(720 * uiScale, 84 * uiScale);
        const sLab = btnSkip.addComponent(Label);
        sLab.string = '直接结算';
        sLab.fontSize = Math.round(32 * uiScale);
        sLab.lineHeight = Math.round(40 * uiScale);
        sLab.color = new Color(205, 218, 240, 190); // 温和次要色
        btnSkip.setPosition(0, skipY, 0);
        n.addChild(btnSkip);

        // 交互
        btnWatch.on(Input.EventType.TOUCH_END, (evt: any) => { evt?.stopPropagation?.(); this._handleReviveWatch(); }, this);
        btnWatch.on(Input.EventType.MOUSE_UP, (evt: any) => { evt?.stopPropagation?.(); this._handleReviveWatch(); }, this);
        btnSkip.on(Input.EventType.TOUCH_END, (evt: any) => { evt?.stopPropagation?.(); this._finalizeGameOver(); }, this);
        btnSkip.on(Input.EventType.MOUSE_UP, (evt: any) => { evt?.stopPropagation?.(); this._finalizeGameOver(); }, this);

        this.uiCanvas.addChild(n);
        this._reviveOverlayNode = n;
        tween(op).to(0.16, { opacity: 255 }, { easing: 'quadOut' }).start();
    }

    private async _handleReviveWatch(): Promise<void> {
        if (this._reviveRequesting) return;
        this._reviveRequesting = true;
        const ok = await this._showRewardedVideoAd();
        this._reviveRequesting = false;
        if (ok) {
            this._reviveCount += 1;
            this._reviveGame();
        } else {
            this._finalizeGameOver();
        }
    }

    private _reviveGame(): void {
        this._hideReviveOverlay();
        this.isGameOver = false;
        this._gameOverFinalized = false;
        this.comboCount = 0;
        this._hideComboBadge();
        // 复活安全：如果当前顶层过薄，回填到可玩厚度
        if (this.baseBlock && this.baseBlock.isValid && this._baseMaxX > 0 && this._baseMaxZ > 0) {
            const cur = this.baseBlock.scale.clone();
            const minX = this._baseMaxX * Math.max(0, Math.min(1, this.reviveMinScaleRatio));
            const minZ = this._baseMaxZ * Math.max(0, Math.min(1, this.reviveMinScaleRatio));
            const newX = Math.max(cur.x, minX);
            const newZ = Math.max(cur.z, minZ);
            if (newX !== cur.x || newZ !== cur.z) {
                this.baseBlock.setScale(new Vec3(newX, cur.y, newZ));
            }
        }
        this.movingBlock = null;
        // 失误后重开一块新方块继续
        this.spawnNextBlock();
        // 若 BGM 已停，重新播放
        if (this.bgmSource && this.bgmSource.isValid && !this.bgmSource.playing) {
            this.bgmSource.play();
        }
    }

    private _finalizeGameOver(): void {
        if (this._gameOverFinalized) return;
        this._gameOverFinalized = true;
        this.isGameOver = true;
        this._hideReviveOverlay();
        // BGM 淡出
        if (this.bgmSource && this.bgmSource.isValid) {
            const vol = { v: this.bgmSource.volume };
            tween(vol)
                .to(this.bgmFadeOut, { v: 0 }, {
                    onUpdate: () => {
                        if (this.bgmSource && this.bgmSource.isValid) {
                            this.bgmSource.volume = vol.v;
                        }
                    }
                })
                .call(() => {
                    if (this.bgmSource && this.bgmSource.isValid) {
                        this.bgmSource.stop();
                    }
                })
                .start();
        }
        this.comboCount = 0; // 游戏结束，连击清零
        this._hideComboBadge();
        if (this.debugLogScores) {
            console.log(`[GameOver] points=${this.points}  layers=${this.score}  finalSpeed=${this.moveSpeed.toFixed(2)}  combo=${this.comboCount}`);
        }
        // —— Minimal: 将本局成绩写入本地排行榜（仅存 device）——
        this._appendLocalLeaderboard(this.points, this.score);
        this._syncWxFriendStorage(); // 关系链数据：好友榜读取
        // 延迟拉远镜头，展示整个堆叠结果
        this.scheduleOnce(() => {
            if (!this._isAlive(this.node) || !this._isAlive(this.cameraNode)) return;
            // 新的拉远摄像机位置计算方式，按塔高度和比例缩放整体缩小
            const towerHeight = (this.score + 1) * this.movingBlockHeight + this.baseBlockHeight;
            // 动态计算 scaleRatio 以适配不同屏幕高宽比
            const screenRatio = screen?.windowSize
                ? screen.windowSize.height / screen.windowSize.width
                : 2.0;
            const idealScreenFactor = 1.0 + screenRatio * 0.5; // 越大越远，基于竖屏比例动态调整
            const scaleRatio = idealScreenFactor;
            const camComp = this.cameraNode.getComponent(Camera);
            const isOrtho = !!camComp && camComp.projection === Camera.ProjectionType.ORTHO;
            if (isOrtho && camComp) {
                // 正交相机：拉远改为放大 orthoHeight，位置和朝向保持为初始设置
                const baseOrtho = this._cameraBaseOrtho ?? camComp.orthoHeight;
                const targetOrtho = baseOrtho + towerHeight * scaleRatio * 0.4;
                const anim = { h: camComp.orthoHeight };
                tween(anim)
                    .stop()
                    .to(1.2, { h: targetOrtho }, {
                        easing: 'cubicOut',
                        onUpdate: () => {
                            if (camComp && camComp.isValid) camComp.orthoHeight = anim.h;
                        }
                    })
                    .start();
            } else {
                // 透视相机：基于场景里设置的相机位置/朝向来推远
                const basePos = this._cameraBasePos?.clone() ?? this.cameraNode.position.clone();
                const dir = basePos.clone();
                if (dir.length() < 0.001) dir.set(1, 1, 1);
                dir.normalize();
                const baseDist = basePos.length();
                const targetDist = baseDist + towerHeight * scaleRatio;
                const farOffset = dir.multiplyScalar(targetDist);
                const focusY = this.baseBlock ? (this.baseBlock.position.y + this.baseBlock.scale.y * 0.5) : 0;
                const farCameraPos = new Vec3(farOffset.x, farOffset.y + focusY, farOffset.z);
                const targetEuler = this._cameraBaseEuler?.clone() ?? this.cameraNode.eulerAngles.clone();

                // 可选增强：防止摄像机动画冲突（如未来出问题可加）
                // tween.stopAllByTarget(this.cameraNode);

                tween(this.cameraNode)
                    .stop()
                    .to(1.2, {
                        position: farCameraPos,
                        eulerAngles: targetEuler // 保持你在场景里设定的视角角度
                    }, { easing: 'cubicOut' })
                    .start();
            }
        }, 1);
        this._showGameOverOverlay(1.25);
    }

    private _handleFailOrRevive(): void {
        this.isGameOver = true;
        if (this._canOfferRevive()) {
            this._showReviveOverlay();
        } else {
            this._finalizeGameOver();
        }
    }

    // —— GameOver 遮罩 ——
    private _ensureGameOverOverlay(): void {
        if (!this._isAlive(this.uiCanvas)) return;
        if (this.gameOverOverlayNode && this.gameOverOverlayNode.isValid) return;

        // 适配当前分辨率，缩放标题/按钮/榜单
        let sw = 750, sh = 1334;
        try {
            const vs = view.getVisibleSize();
            if (vs && vs.width > 0 && vs.height > 0) { sw = vs.width; sh = vs.height; }
        } catch {}
        const baseW = 750, baseH = 1334;
        const uiScale = Math.max(0.72, Math.min(1.0, Math.min(sw / baseW, sh / baseH)));

        const n = new Node('GameOverOverlay');
        n.layer = Layers.Enum.UI_2D;
        const ui = n.addComponent(UITransform);
        ui.setContentSize(sw, sh);
        const op = n.addComponent(UIOpacity);
        op.opacity = 0;
        n.setPosition(0, 0, 0);

        // 标题：游戏结束
        const title = new Node('Title');
        title.layer = Layers.Enum.UI_2D;
        title.addComponent(UITransform).setContentSize(820 * uiScale, 120 * uiScale);
        const tLab = title.addComponent(Label);
        tLab.string = '游戏结束';
        tLab.fontSize = Math.round(60 * uiScale);
        tLab.lineHeight = Math.round(68 * uiScale);
        tLab.color = new Color(255, 255, 255, 255);
        title.setPosition(0, sh * 0.09, 0);
        n.addChild(title);

        // 文本按钮：点击重新开始
        const btn = new Node('RestartButton');
        btn.layer = Layers.Enum.UI_2D;
        btn.addComponent(UITransform).setContentSize(720 * uiScale, 90 * uiScale);
        const bLab = btn.addComponent(Label);
        bLab.string = '点击重新开始';
        bLab.fontSize = Math.round(30 * uiScale);
        bLab.lineHeight = Math.round(36 * uiScale);
        bLab.color = new Color(255, 255, 255, 255);
        btn.setPosition(0, sh * 0.02, 0);
        n.addChild(btn);

        // Show leaderboard on GameOver overlay as well
        this._injectLeaderboard(n, -sh * 0.18, 0.9 * uiScale);

        this.uiCanvas.addChild(n);
        this.gameOverOverlayNode = n;
        // 让好友榜按钮浮在结束遮罩之上，便于点击
        FriendRankView.bringButtonToFront(this.uiCanvas);

        // 淡入
        tween(op).to(0.18, { opacity: 255 }, { easing: 'quadOut' }).start();

        // 点击遮罩或按钮重开（受 restartOnTap 控制）
        if (this.restartOnTap) {
            n.on(Input.EventType.TOUCH_END, (evt: any) => {
                if (this._isEventOnFriendRankUI(evt)) return;
                evt?.stopPropagation?.();
                this._restartGame();
            }, this);
            n.on(Input.EventType.MOUSE_UP, (evt: any) => {
                if (this._isEventOnFriendRankUI(evt)) return;
                evt?.stopPropagation?.();
                this._restartGame();
            }, this);
        } else {
            btn.on(Input.EventType.TOUCH_END, (evt: any) => {
                if (this._isEventOnFriendRankUI(evt)) return;
                evt?.stopPropagation?.();
                this._restartGame();
            }, this);
            btn.on(Input.EventType.MOUSE_UP, (evt: any) => {
                if (this._isEventOnFriendRankUI(evt)) return;
                evt?.stopPropagation?.();
                this._restartGame();
            }, this);
        }
    }

    private _showGameOverOverlay(delaySec: number = 1.25): void {
        this.scheduleOnce(() => {
            if (!this._isAlive(this.node)) return;
            this._ensureCanvasAndLabels();
            this._ensureGameOverOverlay();
        }, delaySec);
    }

    private _hideGameOverOverlay(): void {
        if (!this.gameOverOverlayNode || !this.gameOverOverlayNode.isValid) return;
        const op = this.gameOverOverlayNode.getComponent(UIOpacity) || this.gameOverOverlayNode.addComponent(UIOpacity);
        tween(op)
            .to(0.12, { opacity: 0 }, { easing: 'quadIn' })
            .call(() => {
                if (this.gameOverOverlayNode && this.gameOverOverlayNode.isValid) {
                    this.gameOverOverlayNode.removeFromParent();
                    this.gameOverOverlayNode.destroy();
                    this.gameOverOverlayNode = null;
                }
            })
            .start();
    }

    private _onKeyDown(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_C) {
            this.playPerfectStackWithCombo();
            this.comboCount += 1;
            console.log(`[StackGame][DEBUG] Simulate perfect via C key. comboCount -> ${this.comboCount}`);
        }
        // G：一键触发“第7次完美”成长调试
        if (event.keyCode === KeyCode.KEY_G) {
            this._debugForceStreakGrow();
        }
        // R：重置连击计数
        if (event.keyCode === KeyCode.KEY_R) {
            this.comboCount = 0;
            this._updateComboBadge();
            console.log('[DEBUG] comboCount reset to 0');
        }
        if (event.keyCode === KeyCode.SPACE || event.keyCode === KeyCode.ENTER) {
            if (this.isWaitingStart) this._handleStartTap();
        }
        // GameOver 后快捷键：Space / Enter / N 立即重开
        if (this.isGameOver && (event.keyCode === KeyCode.SPACE || event.keyCode === KeyCode.ENTER || event.keyCode === KeyCode.KEY_N)) {
            this._restartGame();
        }
    }

    update(deltaTime: number) {
        if (this.isGameOver || !this.movingBlock) return;
        if (this.isWaitingStart) return; // 等待开始时不移动

        const dt = Math.min(deltaTime, 1 / 30); // 避免卡帧导致的巨步长，平滑到 ~30FPS
        const range = this.moveRange;
        const step = this.moveSpeed * dt * this.direction; // 单位/秒 → 每帧位移
        const pos = this._tmpPos;
        this.movingBlock.getPosition(pos);

        if (this.moveAxis === 'z') {
            let z = pos.z + step;
            // 平滑反射：把越界的超出量反弹回来，避免边界抖动
            if (z > range) {
                const over = z - range;
                z = range - over;
                this.direction = -1;
            } else if (z < -range) {
                const over = -range - z;
                z = -range + over;
                this.direction = 1;
            }
            this.movingBlock.setPosition(pos.x, pos.y, z);
        } else { // 'x'
            let x = pos.x + step;
            if (x > range) {
                const over = x - range;
                x = range - over;
                this.direction = -1;
            } else if (x < -range) {
                const over = -range - x;
                x = -range + over;
                this.direction = 1;
            }
            this.movingBlock.setPosition(x, pos.y, pos.z);
        }
    }

    playSound(audioClip: AudioClip) {
        const audioSource = this.node.getComponent(AudioSource);
        if (audioSource && audioClip) {
            audioSource.playOneShot(audioClip);
        }
    }

    // —— DEBUG：一键触发“连续第7次完美”的成长效果（无需真实堆叠） ——
    private _debugForceStreakGrow(): void {
        if (!this.baseBlock || !this.baseBlock.isValid) return;
        // 把连击拉到 6，再模拟一次完美（=第7次）
        this.comboCount = Math.max(0, this.streakGrowEvery - 1);
        // 播放对应档位音效，再 +1 到 7
        this.playPerfectStackWithCombo();
        this.comboCount += 1;
        // 视觉：在当前 movingBlock 或 baseBlock 顶面触发完美特效（不改变游戏状态）
        const ref = this.movingBlock ?? this.baseBlock;
        const pos = ref ? ref.position.clone() : new Vec3(0, 0, 0);
        this.showPerfectEffect(pos);
        this._updateComboBadge();
        // 触发“连续 7 次完美后放大”
        this._maybeStreakGrowTop();
        // 日志
        console.log(`[DEBUG] Force streak grow at combo=${this.comboCount}`);
    }

    // 根据连击数播放完美堆叠音效：使用资源梯度，超出封顶到最高档
    private playPerfectStackWithCombo(): void {
        const audioSource = this.node.getComponent(AudioSource);
        if (!audioSource) return;

        // 收集可用音效阶梯（按从低到高顺序）
        const ladder: AudioClip[] = [];
        if (this.blockStackSound) ladder.push(this.blockStackSound);           // 0 档（基础）
        if (this.blockStackSoundHigh) ladder.push(this.blockStackSoundHigh);   // 1 档
        if (this.blockStackSoundHigh1) ladder.push(this.blockStackSoundHigh1); // 2 档
        if (this.blockStackSoundHigh2) ladder.push(this.blockStackSoundHigh2); // 3 档
        if (this.blockStackSoundHigh3) ladder.push(this.blockStackSoundHigh3); // 4 档
        if (this.blockStackSoundHigh4) ladder.push(this.blockStackSoundHigh4); // 5 档
        if (this.blockStackSoundHigh5) ladder.push(this.blockStackSoundHigh5); // 6 档
        if (this.blockStackSoundHigh6) ladder.push(this.blockStackSoundHigh6); // 7 档
        if (ladder.length === 0) return;

        // 封顶映射：超出最高阶时固定使用最高档
        const idx = Math.min(this.comboCount, ladder.length - 1);
        const clip = ladder[idx] ?? ladder[ladder.length - 1];

        // 主播放：当前档位
        audioSource.playOneShot(clip, 1);

        // 方案B：当到达最高档时，叠加一枚轻微“回声”——延迟一点点、音量更小、可用次高档以形成变化感
        const isCapped = this.comboCount >= (ladder.length - 1);
        if (isCapped) {
            const echoDelay = 0.07; // 70ms 轻微回声
            const echoVol = 0.6;    // 更轻一点
            const echoClip = ladder.length >= 2 ? ladder[ladder.length - 2] : clip; // 优先用次高档，缺失则用同一档
            this.scheduleOnce(() => {
                const src = this.node.getComponent(AudioSource);
                if (src && this.isValid) {
                    src.playOneShot(echoClip, echoVol);
                }
            }, echoDelay);
        }
    }

    onTouchStart(evt?: any) {
        // 好友榜面板打开时：所有落块触摸都应忽略（否则会出现“点关闭也落块/误触”）
        if (this._isFriendRankActive() || (evt && this._isEventOnFriendRankUI(evt))) {
            return;
        }
        if (this.isWaitingStart) { 
            this._handleStartTap(); 
            return; 
        }
        if (this.isGameOver) return;
        let wasPerfect = false;

        // Helper function to control precision - avoid floating point errors causing position misalignment
        const precision = (val: number) => Math.round(val * 100) / 100;

        if (this.movingBlock) {
            const movingPos = this.movingBlock.position;
            const basePos = this.baseBlock.position;

            let overlap, currentSize, retainedSize, excessSize;

            if (this.moveAxis === 'z') {
                overlap = movingPos.z - basePos.z;
                currentSize = this.movingBlock.scale.z;
            } else {
                overlap = movingPos.x - basePos.x;
                currentSize = this.movingBlock.scale.x;
            }

            if (Math.abs(overlap) < 0.1) {
                overlap = 0;
            }

            // Apply precision to retainedSize and excessSize to avoid floating point errors
            retainedSize = precision(currentSize - Math.abs(overlap));
            excessSize = precision(currentSize - retainedSize);

        if (retainedSize > 0) {
            if (excessSize === 0) {
                    // 完美堆叠
                    wasPerfect = true;
                    this.playPerfectStackWithCombo();
                    this.comboCount += 1; // 连击 +1（放到播放之后，使第一次完美播放基础音效）
                    this.showPerfectEffect(this.movingBlock.position); // 显示完美堆叠特效
                    this._updateComboBadge();
                    // 完美不在此处直接改速度；改为稍后统一计算增量并限幅（见“合并加速”段）
                    // 修正位置和缩放，确保无缝贴合
                    if (this.moveAxis === 'z') {
                        this.movingBlock.setScale(this.movingBlock.scale.x, this.movingBlock.scale.y, currentSize);
                        this.movingBlock.setPosition(new Vec3(movingPos.x, movingPos.y, basePos.z));
                    } else {
                        this.movingBlock.setScale(currentSize, this.movingBlock.scale.y, this.movingBlock.scale.z);
                        this.movingBlock.setPosition(new Vec3(basePos.x, movingPos.y, movingPos.z));
                    }
                } else {
                    // 不完美堆叠
                    this.comboCount = 0; // 连击中断
                    this._hideComboBadge();
                    this.playSound(this.blockCutSound); // 播放切割音效
                    // 失误减速：更轻微，且不低于手感下限，可在 @property 中调 missSlowRatio/missSlowFloor
                    this.moveSpeed = Math.max(this.missSlowFloor, this.moveSpeed * this.missSlowRatio);
                }

                if (excessSize > 0) {
                    const cutDirection = overlap >= 0 ? 1 : -1;
                    if (this.moveAxis === 'z') {
                        this.movingBlock.setScale(this.movingBlock.scale.x, this.movingBlock.scale.y, retainedSize);
                        const centerOffsetZ = (currentSize - retainedSize) / 2 * cutDirection;
                        const correctedZ = movingPos.z - centerOffsetZ;
                        this.movingBlock.setPosition(new Vec3(movingPos.x, movingPos.y, correctedZ));
                    } else {
                        this.movingBlock.setScale(retainedSize, this.movingBlock.scale.y, this.movingBlock.scale.z);
                        const centerOffsetX = (currentSize - retainedSize) / 2 * cutDirection;
                        const correctedX = movingPos.x - centerOffsetX;
                        this.movingBlock.setPosition(new Vec3(correctedX, movingPos.y, movingPos.z));
                    }

                    // 创建超出部分的节点
                    const cutBlockNode = this._acquireBlock();
                    if (this.moveAxis === 'z') {
                        cutBlockNode.setScale(this.movingBlock.scale.x, this.movingBlock.scale.y, excessSize);
                        const cutZ = movingPos.z + cutDirection * (retainedSize / 2 + excessSize / 2);
                        cutBlockNode.setPosition(new Vec3(movingPos.x, movingPos.y, cutZ));
                    } else {
                        cutBlockNode.setScale(excessSize, this.movingBlock.scale.y, this.movingBlock.scale.z);
                        const cutX = movingPos.x + cutDirection * (retainedSize / 2 + excessSize / 2);
                        cutBlockNode.setPosition(new Vec3(cutX, movingPos.y, movingPos.z));
                    }

                    this.node.addChild(cutBlockNode);

                    // 设置 cutBlockNode 的颜色与 movingBlock 一致
                    const movingMeshRenderer = this.movingBlock.getComponent(MeshRenderer);
                    const cutMeshRenderer = cutBlockNode.getComponent(MeshRenderer);
                    if (movingMeshRenderer && cutMeshRenderer) {
                        const movingMat = movingMeshRenderer.getMaterialInstance(0);
                        const cutMat = cutMeshRenderer.getMaterialInstance(0);
                        const c = this._getMatColor(movingMat) ?? this.getBlockColorByLevel(this.score + 1);
                        this._setMatColor(cutMat, c);
                    }

                    cutBlockNode.setSiblingIndex(0);

                    let offsetVec: Vec3;
                    if (this.moveAxis === 'z') {
                        offsetVec = new Vec3(0, -8, cutDirection * 2);
                    } else {
                        offsetVec = new Vec3(cutDirection * 2, -8, 0);
                    }
                    // 使用 cutBlockNode 的当前位置作为起点
                    const startPos = cutBlockNode.position.clone();
                    const endPos = startPos.add(offsetVec);

                    const randomEuler = new Vec3(
                        180 + Math.random() * 180,
                        180 + Math.random() * 180,
                        180 + Math.random() * 180
                    );

                    tween(cutBlockNode)
                        .to(0.8, {
                            position: endPos,
                            scale: new Vec3(0.1, 0.1, 0.1),
                            eulerAngles: randomEuler
                        }, { easing: 'cubicIn' })
                        .call(() => {
                            if (cutBlockNode && cutBlockNode.isValid) {
                                this._recycle(cutBlockNode, 'block');
                            }
                        })
                        .start();
                }
            } else {
                
                const cutDirection = overlap >= 0 ? 1 : -1;
                const cutBlockNode = this.movingBlock;

                let offsetVec: Vec3;
                if (this.moveAxis === 'z') {
                    offsetVec = new Vec3(0, -8, cutDirection * 2);
                } else {
                    offsetVec = new Vec3(cutDirection * 2, -8, 0);
                }
                // 使用 cutBlockNode 的当前位置作为起点
                const startPos = cutBlockNode.position.clone();
                const endPos = startPos.add(offsetVec);
                const randomEuler = new Vec3(
                    180 + Math.random() * 180,
                    180 + Math.random() * 180,
                    180 + Math.random() * 180
                );

                tween(cutBlockNode)
                    .to(0.8, {
                        position: endPos,
                        scale: new Vec3(0.1, 0.1, 0.1),
                        eulerAngles: randomEuler
                    }, { easing: 'cubicIn' })
                    .call(() => {
                        if (cutBlockNode && cutBlockNode.isValid) {
                            this._recycle(cutBlockNode, 'block');
                        }
                    })
                    .start();

                this.movingBlock = null;
                this._handleFailOrRevive();
                return;
            }

            // 更新"lastBlock"
            this.baseBlock = this.movingBlock;

            this.score += 1;

            // 计分：主显示总分（含完美/连击奖励），副显示层数
            this._addPointsForPlacement(wasPerfect);

            // —— 合并加速（防止开局/连击叠加导致过快）——
            // 思路：把“完美加速”和“普通加速”都先算成增量，再合并、限幅，然后一次性应用。
            {
                let deltaFromPerfect = 0;
                let deltaFromNormal  = 0;

                // A) 完美加速（受 3 个闸门控制）
                if (wasPerfect) {
                    // 1) 前 N 层不因完美加速
                    if (this.score >= this.earlyGraceLayers) {
                        // 2) 基于连击的完美加速（带上限）
                        const comboBoost = Math.min(this.perfectAccelPerCombo * this.comboCount, 0.12);
                        let d = this.perfectAccelBase + comboBoost; // 原本是 0.06 + min(0.02*combo, 0.12)

                        // 3) 接近顶速时衰减完美加速的贡献
                        const speedRatio = Math.min(1, Math.max(0, this.moveSpeed / this.moveSpeedMax));
                        d *= (1 - 0.7 * speedRatio); // 越接近顶速，贡献越小（最低保留 30%）

                        deltaFromPerfect = d;
                    }
                }

                // B) 普通“每层加速”（保持原手感，但转成等效增量）
                if (this.moveSpeedEvery > 0 && (this.score % this.moveSpeedEvery === 0)) {
                    const target = Math.min(this.moveSpeed + this.moveSpeedStep, this.moveSpeedMax);
                    deltaFromNormal = (target - this.moveSpeed) * 0.80; // 逼近 80%
                }

                // C) 合并 + 单次限幅
                let delta = deltaFromPerfect + deltaFromNormal;
                delta = Math.min(delta, this.perPlacementAccelCap);

                // D) 应用并夹到顶速
                if (delta > 0) {
                    this.moveSpeed = Math.min(this.moveSpeedMax, this.moveSpeed + delta);
                }
            }

            // 连续完美达成阈值：放大顶部方块（仅在 7、14、21… 次触发）
            this._maybeStreakGrowTop();
            // 背景随层级变化：使用平滑过渡
            this._tweenBackgroundColor(this.getBlockColorByLevel(this.score), 0.45);

            // 相机抬升控制：前 cameraHoldLayers 层不抬相机，超过后再按高度上移
            if (this.score > this.cameraHoldLayers) {
                // 保持编辑器里的 X/Z，不用代码里的 -10/10
                const cameraOffset = this._cameraBasePos ?? this.cameraNode.position;
                const targetBlockY = this.baseBlock.position.y;
                const currentBlockHeight = this.baseBlock.scale.y;
                const targetCameraY = targetBlockY + currentBlockHeight + 19.5;

                const newCameraPos = new Vec3(
                    cameraOffset.x,
                    targetCameraY,
                    cameraOffset.z
                );

                tween(this.cameraNode)
                    .stop()
                    .to(0.4, { position: newCameraPos }, { easing: 'quadOut' })
                    .start();
            }

            // 切换移动轴
            this.moveAxis = this.moveAxis === 'z' ? 'x' : 'z';
            this.spawnNextBlock();
        }
    }

    spawnNextBlock() {
        if (this.isGameOver) return;

        const newBlock = this._acquireBlock();
        // 按照 baseBlock 的缩放值设置 X 和 Z，Y 轴高度为 movingBlockHeight
        const baseScale = this.baseBlock.scale;
        newBlock.setScale(new Vec3(baseScale.x, this.movingBlockHeight, baseScale.z));

        // 统一写法，确保新方块仅沿当前移动轴负方向滑入，逻辑与 start() 一致
        const retainedPos = this.baseBlock.position.clone();
        const retainedScale = this.baseBlock.scale.clone();
        const newY = retainedPos.y + retainedScale.y / 2 + this.movingBlockHeight / 2;

        // 从更远处直接进入连续运动：统一从负边界外入场，方向始终朝中心（去掉入场 tween，消除“先停一下再动”的观感）
        const edge = Math.max(1, this.spawnOvershoot) * this.moveRange;
        const startX = this.moveAxis === 'x' ? -edge : retainedPos.x;   // 统一从 -edge 入场
        const startZ = this.moveAxis === 'z' ? -edge : retainedPos.z;   // 统一从 -edge 入场
        newBlock.setPosition(new Vec3(startX, newY, startZ));

        // 方向固定为 +1：从 -edge 往 0 移动
        this.direction = 1;

        // Use the color logic with baseHueOffset for all blocks
        // base block 用 baseHueOffset，moving block 用 score + 1
        const color = this.getBlockColorByLevel(this.score + 1);
        const meshRenderer = newBlock.getComponent(MeshRenderer);
        if (meshRenderer) {
            const mat = meshRenderer.getMaterialInstance(0);
            this._setMatColor(mat, color);
        }

        this.node.addChild(newBlock);
        this.movingBlock = newBlock;
    }


    // 轻微的缩放脉冲：先放大再回到“基准缩放”。
    // 为防止频繁触发导致“越抖越大”，在动画前停止旧 tween，并强制回到基准值。
    private _punchScale(target: Node, amount: number = 0.08, duration: number = 0.18) {
        if (!target || !target.isValid) return;
        // 基准 = 第一次记录下来的 scale（通常是 1,1,1）
        const base = (this._uiBaseScale.get(target)?.clone()) ?? target.scale.clone();
        this._uiBaseScale.set(target, base.clone());
        // 停止先前的缩放动画，避免叠加导致尺度漂移
        try { (tween as any).stopAllByTarget?.(target); } catch {}
        // 回到基准再做一次脉冲
        target.setScale(base);
        const up = new Vec3(base.x * (1 + amount), base.y * (1 + amount), base.z * (1 + amount));
        tween(target)
            .to(duration * 0.5, { scale: up }, { easing: 'quadOut' })
            .to(duration * 0.5, { scale: base }, { easing: 'quadIn' })
            .start();
    }

    // 超短白屏闪：把背景颜色快速拉到白色再回落（无需新资源）
    private _whiteScreenFlash(duration: number = 0.08) {
        const bg = this.backgroundPlane ?? this.node.parent?.getChildByName('BackgroundPlane');
        if (!bg) return;
        const mr = bg.getComponent(MeshRenderer);
        if (!mr) return;
        const mat = mr.getMaterialInstance(0);
        if (!mat) return;

        const cur = this._getMatColor(mat) ?? new Color(255, 255, 255, 255);
        const anim = new Color(cur);
        const white = new Color(255, 255, 255, 255);

        tween(anim)
            .to(duration * 0.5, { r: white.r, g: white.g, b: white.b, a: white.a }, {
                onUpdate: () => this._setMatColor(mat, anim)
            })
            .to(duration * 0.5, { r: cur.r, g: cur.g, b: cur.b, a: cur.a }, {
                onUpdate: () => this._setMatColor(mat, anim)
            })
            .start();
    }

    // 轻微摄像机抖动（短促、不过火）
    private _cameraShake(intensity: number = 0.04, duration: number = 0.16) {
        if (!this.cameraNode || !this.cameraNode.isValid) return;
        const cam = this.cameraNode;
        const base = cam.position.clone();
        const rand = () => (Math.random() * 2 - 1) * intensity;
        tween(cam)
            .stop()
            .to(duration * 0.34, { position: new Vec3(base.x + rand(), base.y + rand(), base.z + rand()) })
            .to(duration * 0.33, { position: new Vec3(base.x + rand(), base.y + rand(), base.z + rand()) })
            .to(duration * 0.33, { position: base })
            .start();
    }

    // 当前块颜色做一次快速提亮脉冲
    private _pulseBlockColor(target: Node, factor: number = 1.15, duration: number = 0.16) {
        if (!target || !target.isValid) return;
        const mr = target.getComponent(MeshRenderer);
        if (!mr) return;
        const mat = mr.getMaterialInstance(0);
        if (!mat) return;
        const cur = this._getMatColor(mat) ?? new Color(255,255,255,255);
        const bright = new Color(
            Math.min(255, Math.round(cur.r * factor)),
            Math.min(255, Math.round(cur.g * factor)),
            Math.min(255, Math.round(cur.b * factor)),
            cur.a
        );
        const anim = new Color(cur);
        tween(anim)
            .to(duration * 0.5, { r: bright.r, g: bright.g, b: bright.b, a: bright.a }, { onUpdate: () => this._setMatColor(mat, anim) })
            .to(duration * 0.5, { r: cur.r, g: cur.g, b: cur.b, a: cur.a }, { onUpdate: () => this._setMatColor(mat, anim) })
            .start();
    }

    private _computeHaloColor(strong: boolean, refColor?: Color): Color {
        // 以当前方块颜色为基础做提亮；强外扩时更亮并略降透明
        const base = (refColor ?? new Color(255, 255, 255, 255)).clone();
        const factor = strong ? 1.28 : 1.18; // 强档更亮
        const r = Math.min(255, Math.round(base.r * factor));
        const g = Math.min(255, Math.round(base.g * factor));
        const b = Math.min(255, Math.round(base.b * factor));
        const a = strong ? Math.max(0, Math.round(base.a * 0.9)) : base.a;
        return new Color(r, g, b, a);
    }

    private _spawnPerfectHalo(pos: Vec3, combo: number, isBurst: boolean = false) {
        if (!this.blockPrefab) return;

        // 参考当前 moving block 的尺寸，光环要贴边
        const ref = this.movingBlock ?? null;
        const sx = ref ? ref.scale.x : 1.0;
        const sy = ref ? ref.scale.y : 0.7;
        const sz = ref ? ref.scale.z : 1.0;

        // 放在顶面略上方，避免与顶面 Z-fighting
        const ringY = pos.y + sy * 0.5 + 0.01;

        // 光环厚度（条块短边），随尺寸/连击微调
        const k = Math.min(Math.max(combo, 0), 6);
        const baseT = Math.min(sx, sz) * 0.08;
        const thickness = Math.max(0.04, Math.min(0.22, baseT + k * 0.005));

        // 初始内径长度（贴边加少量 margin）
        const margin = Math.max(0.02, Math.min(0.06, Math.min(sx, sz) * 0.015));
        const innerX = sx + margin;
        const innerZ = sz + margin;

        // 光环父节点
        const ring = new Node('HaloRing');
        ring.setPosition(new Vec3(pos.x, ringY, pos.z));
        this.node.addChild(ring);

        // 收集材质实例以便淡出
        const _haloMats: (Material | null)[] = [];
        const _haloStrips: Node[] = [];

        // 计算提亮颜色
        let refColor: Color | null = null;
        if (ref) {
            const mr = ref.getComponent(MeshRenderer);
            if (mr) {
                const mat = mr.getMaterialInstance(0);
                refColor = mat ? (this._getMatColor(mat) ?? null) : null;
            }
        }
        const finalColor = this._computeHaloColor(isBurst, refColor ?? undefined);

        // 工具：创建一条条块段（沿X或沿Z）
        const makeStrip = (name: string, alongX: boolean, len: number, thick: number, localPos: Vec3) => {
            const n = this._acquireStrip();
            n.name = name;
            n.setPosition(localPos);
            // 极薄Y，外观看成一条发光边
            const scale = alongX ? new Vec3(len, 0.02, thick) : new Vec3(thick, 0.02, len);
            n.setScale(scale);
            ring.addChild(n);

            // 设置颜色为提亮版，并收集材质实例
            const mr = n.getComponent(MeshRenderer);
            if (mr) {
                // 若配置了光环专用材质，则不再使用 blockPrefab 的材质
                if (this.haloMaterial) {
                    mr.setMaterial(this.haloMaterial, 0);
                    this._matColorKey = null;
                }
                const m = mr.getMaterialInstance(0);
                if (m) {
                    this._setMatColor(m, finalColor);
                    _haloMats.push(m);
                } else {
                    _haloMats.push(null);
                }
            }
            _haloStrips.push(n);
            return n;
        };

        // 四条：Top/Bottom 沿X；Left/Right 沿Z
        const halfZ = innerZ / 2 + thickness / 2;
        const halfX = innerX / 2 + thickness / 2;

        const top    = makeStrip('HaloTop',    true,  innerX, thickness, new Vec3(0, 0,  halfZ));
        const bottom = makeStrip('HaloBottom', true,  innerX, thickness, new Vec3(0, 0, -halfZ));
        const left   = makeStrip('HaloLeft',   false, innerZ, thickness, new Vec3(-halfX, 0, 0));
        const right  = makeStrip('HaloRight',  false, innerZ, thickness, new Vec3( halfX, 0, 0));

        // 动画：整体外扩（len↑、thickness↓），强档位移更远
        // 阈值达成（第5次及以后）显著增强外扩距离与长度增长
        const strong = !!isBurst;
        const dur = strong ? 0.42 : 0.35; // 强外扩：时间略长，张力更足
        const lenGrow = (strong ? 1.60 : 1.10) + k * (strong ? 0.03 : 0.01); // 强：外扩更远
        const thickShrink = strong ? 0.50 : 0.65;                             // 强：更薄更锐利
        const posGrowFactor = strong ? 1.60 : 0.60;                           // 强：外移更明显

        // 目标尺寸
        const targetTopScale    = new Vec3(innerX * lenGrow, 0.02, thickness * thickShrink);
        const targetBottomScale = new Vec3(innerX * lenGrow, 0.02, thickness * thickShrink);
        const targetLeftScale   = new Vec3(thickness * thickShrink, 0.02, innerZ * lenGrow);
        const targetRightScale  = new Vec3(thickness * thickShrink, 0.02, innerZ * lenGrow);

        // 条块外扩时，中心位置随之外移（强档位移更远）
        const targetTopPos    = new Vec3(0, 0,  halfZ * (1 + (lenGrow - 1) * posGrowFactor));
        const targetBottomPos = new Vec3(0, 0, -halfZ * (1 + (lenGrow - 1) * posGrowFactor));
        const targetLeftPos   = new Vec3(-halfX * (1 + (lenGrow - 1) * posGrowFactor), 0, 0);
        const targetRightPos  = new Vec3( halfX * (1 + (lenGrow - 1) * posGrowFactor), 0, 0);

        tween(top).to(dur,    { scale: targetTopScale,    position: targetTopPos    }, { easing: 'quadOut' }).start();
        tween(bottom).to(dur, { scale: targetBottomScale, position: targetBottomPos }, { easing: 'quadOut' }).start();
        tween(left).to(dur,   { scale: targetLeftScale,   position: targetLeftPos   }, { easing: 'quadOut' }).start();
        tween(right).to(dur,  { scale: targetRightScale,  position: targetRightPos  }, { easing: 'quadOut' }).start();

        // 强外扩：在运动同时做颜色淡出，避免尾部停留太久
        if (strong && _haloMats.length > 0) {
            for (const m of _haloMats) {
                if (!m) continue;
                const start = this._getMatColor(m) ?? finalColor;
                const anim = new Color(start);
                tween(anim)
                    .to(dur * 0.9, { a: 0 }, { onUpdate: () => this._setMatColor(m, anim) })
                    .start();
            }
        }

        // 动画结束后清理
        this.scheduleOnce(() => {
            if (!this.isValid) return;
            // 回收条带，环节点销毁即可（只是一层空壳）
            for (const s of _haloStrips) {
                if (s && s.isValid) this._recycle(s, 'strip');
            }
            if (ring && ring.isValid) {
                ring.removeFromParent();
                ring.destroy();
            }
        }, dur + 0.02);
    }

    // 纯代码的“四向爆发”特效：不依赖 prefab 的 LightLine 节点
    private _proceduralBurst(pos: Vec3, combo: number): void {
        // 参考当前 moving block 尺寸
        const ref = this.movingBlock ?? null;
        const sx = ref ? ref.scale.x : 1.0;
        const sy = ref ? ref.scale.y : 0.7;
        const sz = ref ? ref.scale.z : 1.0;
        const y = pos.y + sy * 0.5 + 0.01; // 贴近顶面

        // 颜色：取当前块材质色做 1.22x 提亮
        let refColor: Color | null = null;
        if (ref) {
            const mr = ref.getComponent(MeshRenderer);
            if (mr) {
                const m = mr.getMaterialInstance(0);
                refColor = m ? (this._getMatColor(m) ?? null) : null;
            }
        }
        const base = refColor ?? new Color(255, 255, 255, 255);
        const glow = new Color(
            Math.min(255, Math.round(base.r * 1.22)),
            Math.min(255, Math.round(base.g * 1.22)),
            Math.min(255, Math.round(base.b * 1.22)),
            base.a
        );

        // 工具：创建一条“光线条”
        const makeStrip = (name: string, alongX: boolean, len: number, thick: number, worldPos: Vec3) => {
            const n = this._acquireStrip();
            n.name = name;
            n.setPosition(worldPos);
            const scale = alongX ? new Vec3(len, 0.02, thick) : new Vec3(thick, 0.02, len);
            n.setScale(scale);
            this.node.addChild(n);
            const mr = n.getComponent(MeshRenderer);
            if (mr) {
                if (this.haloMaterial) {
                    mr.setMaterial(this.haloMaterial, 0);
                    this._matColorKey = null;
                }
                const m = mr.getMaterialInstance(0);
                if (m) this._setMatColor(m, glow);
            }
            return n;
        };

        // 初始长度基于方块边，厚度随 combo 略增强
        const k = Math.min(Math.max(combo, 0), 6);
        const baseT = Math.min(sx, sz) * 0.095;
        const thickness = Math.max(0.045, Math.min(0.24, baseT + k * 0.006));
        const innerX = sx * 0.96;
        const innerZ = sz * 0.96;

        // 四条条带相对中心的位置（贴边）
        const halfZ = innerZ / 2 + thickness / 2;
        const halfX = innerX / 2 + thickness / 2;

        const center = new Vec3(pos.x, y, pos.z);
        const top    = makeStrip('BurstTop',    true,  innerX, thickness, new Vec3(center.x, center.y, center.z +  halfZ));
        const bottom = makeStrip('BurstBottom', true,  innerX, thickness, new Vec3(center.x, center.y, center.z -  halfZ));
        const left   = makeStrip('BurstLeft',   false, innerZ, thickness, new Vec3(center.x - halfX, center.y, center.z));
        const right  = makeStrip('BurstRight',  false, innerZ, thickness, new Vec3(center.x + halfX, center.y, center.z));
        const strips = [top, bottom, left, right];

        // 动画参数：外扩 + 变细 + 轻微外移
        const dur = 0.35;
        const lenGrow = 1.12 + k * 0.012;
        const thickShrink = 0.6;
        const posGrow = 0.52 * (lenGrow - 1);

        const targetTopScale    = new Vec3(innerX * lenGrow, 0.02, thickness * thickShrink);
        const targetBottomScale = new Vec3(innerX * lenGrow, 0.02, thickness * thickShrink);
        const targetLeftScale   = new Vec3(thickness * thickShrink, 0.02, innerZ * lenGrow);
        const targetRightScale  = new Vec3(thickness * thickShrink, 0.02, innerZ * lenGrow);

        const targetTopPos    = new Vec3(top.position.x,    top.position.y,    top.position.z    * (1 + posGrow * 0.65));
        const targetBottomPos = new Vec3(bottom.position.x, bottom.position.y, bottom.position.z * (1 + posGrow * 0.65));
        const targetLeftPos   = new Vec3(left.position.x   * (1 + posGrow * 0.65), left.position.y,  left.position.z);
        const targetRightPos  = new Vec3(right.position.x  * (1 + posGrow * 0.65), right.position.y, right.position.z);

        tween(top)   .to(dur, { scale: targetTopScale,    position: targetTopPos },    { easing: 'quadOut' }).start();
        tween(bottom).to(dur, { scale: targetBottomScale, position: targetBottomPos }, { easing: 'quadOut' }).start();
        tween(left)  .to(dur, { scale: targetLeftScale,   position: targetLeftPos },   { easing: 'quadOut' }).start();
        tween(right) .to(dur, { scale: targetRightScale,  position: targetRightPos },  { easing: 'quadOut' }).start();

        // 收尾销毁
        this.scheduleOnce(() => {
            if (!this.isValid) return;
            strips.forEach(n => { if (n && n.isValid) this._recycle(n, 'strip'); });
        }, dur + 0.02);
    }

    showPerfectEffect(position: Vec3) {
        // 依据连击数小幅增强（有上限，避免过火）
        const combo = Math.min(this.comboCount, 6);
        const threshold = this.burstComboThreshold;
        const shouldBurst = this.comboCount >= threshold;
        // 满足阈值时按开关决定是否触发纯代码爆发特效
        if (shouldBurst && this.useProceduralBurst) {
            this._proceduralBurst(position, this.comboCount);
        }
        const duration = 0.72 - combo * 0.03; // 0.72 → 0.54s
        const distance = 4.8 + combo * 0.22;  // 4.8 → 6.12
        const punch = 0.08 + combo * 0.01;    // 0.08 → 0.14
        const shake = 0.02 + combo * 0.004;   // 0.06 → 0.084

        const effect = this._acquireEffect();
        if (!effect) {
            return;
        }
        effect.setPosition(position);
        this.node.addChild(effect);

        // 禁用四条线（不论程序化/Prefab），设计要求：第5次起只保留外扩光环
        const showLines = false;
        const lineNames = ['LightLineTop', 'LightLineBottom', 'LightLineLeft', 'LightLineRight'];
        for (const n of lineNames) {
            const child = effect.getChildByName(n);
            if (child) child.active = showLines;
        }

        // 中心“亮一下”：当前块做一次轻微缩放 + 颜色提亮
        this._punchScale(this.movingBlock ?? effect, punch, 0.18);
        this._flashBlockStrong(this.movingBlock ?? effect, combo);
        this._pulseBlockColor(this.movingBlock ?? effect, 1.15 + combo * 0.01, 0.16);
        this._cameraShake(shake, 0.16);
        // 连击≥2时加一个超短白屏闪，更接近 Ketchapp 的“干净亮闪”
        if (this.comboCount >= 2) {
            this._whiteScreenFlash(0.07);
        }
        // 新增：中心光晕
        this._spawnPerfectHalo(position, this.comboCount, shouldBurst);

        // 第5次起仅保留“外扩光环”，不再显示四条线爆发（程序化/Prefab 均禁用）

        // 自动销毁
        this.scheduleOnce(() => {
            if (!this.isValid) return;
            this._recycle(effect, 'effect');
        }, duration + 0.12);
    }
}
