import { _decorator, Component, Node, UITransform, Layers, director, Label, BlockInputEvents, SubContextView, Size, view, Color, Graphics, UIOpacity, Input, sys, Vec2, screen, Canvas, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

declare const wx: any;

@ccclass('FriendRankView')
export class FriendRankView extends Component {
    private static _instance: FriendRankView | null = null;
    private static _backdropNode: Node | null = null;
    private static _buttonNode: Node | null = null;
    private static _buttonResizeBound: boolean = false;
    // —— Backdrop event handlers (must be stable references for off/on) —— 
    private static _onBackdropSwallow: ((e: any) => void) | null = null;
    private static _onBackdropClose: ((e: any) => void) | null = null;
    private static _backdropColorLocked: boolean = false; // 由运行时动态颜色锁定，避免 onLoad 覆盖

    private static readonly _btnMarginXBase = 36;
    private static readonly _btnMarginYBase = 120; // 稍微下移，使其与右侧分数更齐平
    // 默认用不透明白色：确保完全遮挡下层 UI（需要半透明可在 Inspector 里改 backdropColor）
    private static _backdropColor: Color = new Color(255, 255, 255, 255);
    @property
    defaultWidth: number = 650;
    @property
    defaultHeight: number = 850;
    @property
    defaultMarginTop: number = 120;
    @property({ type: Color })
    backdropColor: Color = new Color(255, 255, 255, 255);
    private _closeNode: Node | null = null;
    private _canClose: boolean = false;
    private _closeArmTimer: number = 0;
    // scheduleOnce callback reference for arming close (avoid unscheduleAllCallbacks)
    private _armCloseCb: (() => void) | null = null;

    onLoad() {
        FriendRankView._instance = this;
        this.node.layer = Layers.Enum.UI_2D;
        const ui = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        // 阻止点击穿透到下层 UI（避免 show 后同一次点击又触发其它层的关闭逻辑）
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }
        // 仅在未被动态颜色锁定时才记录 Inspector 默认色，避免覆盖运行时同步的颜色
        if (!FriendRankView._backdropColorLocked) {
            FriendRankView._backdropColor = this.backdropColor ? this.backdropColor.clone() : new Color(0, 0, 0, 160);
        } else if (this.backdropColor) {
            // 若已锁定，确保实例字段与已锁定色一致，避免后续 _repaintBackdrop 走实例分支取旧值
            this.backdropColor = FriendRankView._backdropColor.clone();
        }
        // 只在首次且未设置尺寸时使用默认值；避免覆盖 show() 传入/计算后的尺寸
        if (ui.contentSize.width === 0 && ui.contentSize.height === 0) {
            ui.setContentSize(this.defaultWidth, this.defaultHeight);
        }
        ui.setAnchorPoint(0.5, 0.5); // 居中锚点：直接算中心点再偏移
        // 按 Cocos 官方流程：由 SubContextView 负责把 sharedCanvas 渲染到该节点上
        const sub = this.node.getComponent(SubContextView) || this.node.addComponent(SubContextView);
        const sz = ui.contentSize;
        sub.designResolutionSize = new Size(Math.floor(sz.width), Math.floor(sz.height));

        // 关闭按钮：右上角 X 图标（不依赖贴图）
        const close = new Node('FriendRankClose');
        close.layer = Layers.Enum.UI_2D;
        // 用一个可点击的 UITransform 区域
        const cui = close.addComponent(UITransform);
        cui.setContentSize(64, 64);
        (cui as any).priority = 1000; // 提高命中优先级，确保优先于遮罩
        try { (cui as any).priority = 1000; } catch {}
        try { (cui as any).layer = Layers.Enum.UI_2D; } catch {}
        // 关闭按钮自身用中心锚点，确保 Graphics/Label 以 (0,0) 为中心绘制可见
        cui.setAnchorPoint(0.5, 0.5);

        // 初始位置：右上角内缩
        const padding = 16;
        const half = 32; // 64/2，按钮中心偏移
        close.setPosition((ui.contentSize.width / 2) - padding - half, -padding - half, 0);

        // 更接近微信/系统弹层：浅灰圆底 + 深灰 X
        const bg = close.addComponent(Graphics);
        bg.clear();
        bg.fillColor = new Color(0, 0, 0, 35); // 轻薄的灰底
        bg.circle(0, 0, 24);
        bg.fill();

        // 画一个矢量 X，放到子节点防止多 Graphics 互相覆盖
        const crossNode = new Node('CloseVectorX');
        crossNode.layer = Layers.Enum.UI_2D;
        const crossUi = crossNode.addComponent(UITransform);
        crossUi.setContentSize(64, 64);
        try { (crossUi as any).priority = 1000; } catch {}
        const cross = crossNode.addComponent(Graphics);
        cross.clear();
        cross.lineWidth = 5;
        cross.lineCap = Graphics.LineCap.ROUND;
        cross.strokeColor = new Color(220, 40, 40, 255); // 红色 X，区分背景
        cross.moveTo(-10, -10);
        cross.lineTo(10, 10);
        cross.moveTo(10, -10);
        cross.lineTo(-10, 10);
        cross.stroke();
        (cross as any).priority = 10;
        crossNode.setPosition(0, 0, 0);
        close.addChild(crossNode);

        const handleClose = (e: any) => {
            e?.stopPropagation?.();
            console.log('[FriendRankView] close tapped, canClose=', this._canClose);
            if (!this._canClose) return;
            FriendRankView.hide();
        };
        close.on('touchstart', (e: any) => {
            console.log('[FriendRankView] close touchstart');
        });
        close.on('mousedown', (e: any) => {
            console.log('[FriendRankView] close mousedown');
        });
        close.on('touchend', handleClose);
        // desktop 兼容：避免 mouseup 与 touchend 在部分环境重复触发
        close.on('mouseup', handleClose);

        // 注意：SubContextView 可能会覆盖子节点渲染，因此把 close 挂到与面板同级（Canvas）上，确保永远在最上层
        const host = this.node.parent ?? this.node;
        host.addChild(close);
        close.setSiblingIndex(host.children.length - 1);
        this._closeNode = close;
        // 刚 show 出来时，避免同一次点击/抬手误点到关闭按钮导致“闪一下就没了”
        this._armClose(0.15);
    }

    onDestroy() {
        if (FriendRankView._instance === this) {
            FriendRankView._instance = null;
        }
        if (FriendRankView._backdropNode && FriendRankView._backdropNode.isValid) {
            FriendRankView._backdropNode.active = false;
        }
        if (this._closeNode && this._closeNode.isValid) {
            try {
                this._closeNode.removeFromParent();
                this._closeNode.destroy();
            } catch {}
        }
        this._closeNode = null;
    }

    private _armClose(delaySec: number = 0.15) {
        this._canClose = delaySec <= 0;

        // 只取消自己这一项定时，避免误伤其它 schedule 逻辑
        if (this._armCloseCb) {
            try { this.unschedule(this._armCloseCb); } catch {}
        }

        if (delaySec > 0) {
            this._closeArmTimer = Date.now();
            this._armCloseCb = () => {
                this._canClose = true;
                console.log('[FriendRankView] close armed', Date.now() - this._closeArmTimer, 'ms');
            };
            this.scheduleOnce(this._armCloseCb, delaySec);
        }
    }

    update(dt: number) {
        // 按 Cocos 官方流程：由 SubContextView 负责把 sharedCanvas 渲染到该节点上。
        // 主域不再手动 uploadData(sharedCanvas)，避免与引擎同步逻辑冲突。
    }

    private static _clampSize(width: number, height: number): { w: number; h: number; max: number } {
        const maxTexSize = director.root?.device?.capabilities?.maxTextureSize ?? 2048;
        const fallbackW = 650;
        const fallbackH = 850;

        // 兜底：非数字/无效值时用默认值，避免 NaN 进入纹理重置
        let w = Number.isFinite(width) ? width : fallbackW;
        let h = Number.isFinite(height) ? height : fallbackH;

        // 避免创建 0 尺寸纹理
        if (w <= 0) w = 1;
        if (h <= 0) h = 1;

        // 对齐到偶数：微信/Chromium 某些 sharedCanvas->拷贝路径对奇数尺寸很敏感
        w = Math.max(2, Math.floor(w));
        h = Math.max(2, Math.floor(h));
        if (w % 2 !== 0) w -= 1;
        if (h % 2 !== 0) h -= 1;

        if (w > maxTexSize || h > maxTexSize) {
            const scale = maxTexSize / Math.max(w, h);
            w = Math.max(1, Math.floor(w * scale));
            h = Math.max(1, Math.floor(h * scale));
        }

        // 缩放后再对齐一次（可能变成奇数）
        if (w % 2 !== 0) w -= 1;
        if (h % 2 !== 0) h -= 1;
        w = Math.max(2, w);
        h = Math.max(2, h);
        return { w, h, max: maxTexSize };
    }

        // —— 静态接口：供主域调用 ——
        public static show(width?: number, height?: number, marginTop?: number) {
        const scene = director.getScene();
        if (!scene) return;

        let root: Node | null = null;
        let inst: FriendRankView | null = null;
        let ui: UITransform | null = null;

        // 优先使用已缓存的实例
        if (this._instance && this._instance.node && this._instance.node.isValid) {
            root = this._instance.node;
            inst = this._instance;
        } else {
            // 你的层级是 Canvas/FriendRankRoot，所以要先从 Canvas 下找
            const canvas = scene.getChildByName('Canvas');
            const foundInCanvas = canvas?.getChildByName('FriendRankRoot');
            const foundInScene = scene.getChildByName('FriendRankRoot');
            const found = (foundInCanvas && foundInCanvas.isValid) ? foundInCanvas
                : (foundInScene && foundInScene.isValid) ? foundInScene
                : null;

            if (found) {
                root = found;
                inst = found.getComponent(FriendRankView);
            }
        }

        // 若场景里不存在，则创建一个挂到 Canvas（或 scene）下，避免重复创建同名节点
        if (!root) {
            const canvas = scene.getChildByName('Canvas');
            root = new Node('FriendRankRoot');
            (canvas ?? scene).addChild(root);
        }

        if (!inst && root) {
            inst = root.addComponent(FriendRankView);
        }
        if (inst) {
            this._instance = inst;
            inst.enabled = true;
        }
        // 解析调用参数：优先用入参，否则落到组件的默认属性
        const hasW = Number.isFinite(width);
        const hasH = Number.isFinite(height);

        ui = root?.getComponent(UITransform) ?? null;
        const sceneW = ui?.contentSize?.width ?? 0;
        const sceneH = ui?.contentSize?.height ?? 0;
        const sceneHasSize = (sceneW > 0 && sceneH > 0);

        const baseW = sceneHasSize ? sceneW : (inst?.defaultWidth ?? 650);
        const baseH = sceneHasSize ? sceneH : (inst?.defaultHeight ?? 850);

        const targetW = hasW ? (width as number) : baseW;
        const targetH = hasH ? (height as number) : baseH;

        const resolvedMarginTop = Number.isFinite(marginTop) ? (marginTop as number) : (inst?.defaultMarginTop ?? 120);
        const clamped = this._clampSize(targetW, targetH);
        console.log('[FriendRankView] show', {
            width: targetW,
            height: targetH,
            marginTop: resolvedMarginTop,
            appliedWidth: clamped.w,
            appliedHeight: clamped.h,
            maxTex: clamped.max,
        });
        if (root) {
            root.active = true; // 激活后触发 onLoad / init
            if (!root.getComponent(BlockInputEvents)) {
                root.addComponent(BlockInputEvents);
            }
            ui = root.getComponent(UITransform);
            if (!ui) {
                ui = root.addComponent(UITransform);
            }
            // 默认让 Scene 接管：只有显式传参（或 Scene 没有尺寸）才写回尺寸
            const shouldResize = (hasW || hasH) || !sceneHasSize;

            if (shouldResize) {
                ui.setContentSize(clamped.w, clamped.h);
            }
            ui.setAnchorPoint(0.5, 0.5);
        }
        // 以中心锚点计算：让面板顶部距父节点顶部留出 marginTop
        const parentUI = root?.parent?.getComponent(UITransform);
        const parentH = parentUI ? parentUI.contentSize.height : view.getVisibleSize().height;
        const panelH = ui ? ui.contentSize.height : clamped.h;
        const topMargin = inst ? inst._calcMarginTop(parentH, resolvedMarginTop) : resolvedMarginTop;
        // 直接以中心定位：先算完美居中时的偏移，再额外上移 topMargin
        const centerY = ((parentH - panelH) * 0.1) - topMargin;
        root?.setPosition(0, centerY, 0);

        // 更新关闭按钮位置：close 为 root 的同级节点（Canvas 下），用父坐标系定位到“面板右上角内缩”
        const close = (root?.getComponent(FriendRankView) as any)?._closeNode as Node | null;
        if (close && close.isValid) {
            const cui = close.getComponent(UITransform);
            if (cui) {
                cui.setAnchorPoint(0.5, 0.5);
                const padding = 16;
                const half = 32; // 64/2
                const panelW = ui ? ui.contentSize.width : clamped.w;
                const panelHNow = ui ? ui.contentSize.height : clamped.h;

                // root 的锚点为 (0.5, 0.5)：position 是面板中心点（在父坐标系）
                const rx = root?.position?.x ?? 0;
                const ry = root?.position?.y ?? 0;

                const x = rx + (panelW / 2) - padding - half;
                const y = ry + (panelHNow / 2) - padding - half;
                close.setPosition(x, y, 0);

                // 保证 close 永远在最上层
                const host = close.parent;
                if (host) close.setSiblingIndex(host.children.length - 1);
            }
        }

        // 在排行榜下方放置全屏遮罩，既遮挡又拦截点击
        this._ensureBackdrop(root, inst);

        // 每次 show 都重新“武装”关闭按钮，避免误触
        inst?._armClose(0.15);

        // 保证关闭按钮激活
        const closeNode = (root?.getComponent(FriendRankView) as any)?._closeNode as Node | null;
        if (closeNode && closeNode.isValid) closeNode.active = true;

        // 同步 SubContextView 设计分辨率（Cocos 会在加载阶段设置 sharedCanvas 尺寸）
        const sub2 = root?.getComponent(SubContextView);
        if (sub2) {
            // 默认让 Scene(Inspector) 接管 designResolutionSize：
            // 仅当显式传参覆盖尺寸，或 Inspector 未配置(<=0) 才同步
            const dr2 = (sub2 as any).designResolutionSize as Size | undefined;
            const drInvalid = !dr2 || dr2.width <= 0 || dr2.height <= 0;

            if (hasW || hasH || drInvalid) {
                sub2.designResolutionSize = new Size(clamped.w, clamped.h);
                // 重新触发一次，使 sharedCanvas 尺寸按设计分辨率更新
                sub2.enabled = false;
                sub2.enabled = true;
            }
        }

        if (typeof wx !== 'undefined') {
            const ctx = wx.getOpenDataContext?.();
            // 仅通知子域重绘/显示；sharedCanvas 尺寸由 SubContextView 控制
            ctx?.postMessage?.({ type: 'SHOW_FRIEND_RANK', width: clamped.w, height: clamped.h });
        }
    }

    public static hide() {
        console.log('[FriendRankView] hide');
        if (this._instance && this._instance.node && this._instance.node.isValid) {
            this._instance.node.active = false;
            // 停止 update 上传，避免隐藏期间 sharedCanvas 变更尺寸导致 WebGL 报错
            this._instance.enabled = false;
        }
        if (this._backdropNode && this._backdropNode.isValid) {
            this._backdropNode.active = false;
        }
        // 隐藏关闭按钮
        const close = (this._instance as any)?._closeNode as Node | null;
        if (close && close.isValid) close.active = false;
        if (typeof wx !== 'undefined') {
            const ctx = wx.getOpenDataContext?.();
            ctx?.postMessage?.({ type: 'HIDE_FRIEND_RANK' });
        }
    }

    // 按屏幕高度等比缩放并叠加安全区的上边距算法，避免写死一个像素值
    private _calcMarginTop(parentH: number, marginTop: number): number {
        const minPx = 10; // 最少留白
        const maxPx = parentH * 1; // 最多占到屏幕 100%

        // marginTop 视为“当前坐标系下的像素值”，不再按设计稿二次缩放
        let result = Number.isFinite(marginTop) ? marginTop : minPx;
        result = Math.min(Math.max(result, minPx), maxPx);

        // 如需考虑安全区刘海，可在这里叠加 safeArea.top；当前按需求暂不处理
        return result;
    }

    public static setBackdropColor(color: Color | null | undefined) {
        if (!color) return;
        // 同步静态值与实例字段，避免实例优先级覆盖动态色
        this._backdropColor = color.clone();
        this._backdropColorLocked = true;
        const inst = this._instance;
        if (inst && inst.isValid) {
            inst.backdropColor = color.clone();
        }
        if (this._backdropNode && this._backdropNode.isValid) {
            this._repaintBackdrop(this._backdropNode, this._instance);
        }
    }

    private static _ensureBackdrop(root: Node | null, inst?: FriendRankView | null): Node | null {
        const scene = director.getScene();
        if (!scene) return null;
        const host = root?.parent ?? scene.getChildByName('Canvas') ?? scene;
        if (!host) return null;

        let mask = this._backdropNode;
        if (!mask || !mask.isValid || mask.parent !== host) {
            mask = new Node('FriendRankBackdrop');
            mask.layer = Layers.Enum.UI_2D;
            host.addChild(mask);
            this._backdropNode = mask;
        }
        mask.active = true;

        if (!mask.getComponent(BlockInputEvents)) {
            mask.addComponent(BlockInputEvents);
        }
        const ui = mask.getComponent(UITransform) || mask.addComponent(UITransform);
        const hostUI = host.getComponent(UITransform);
        const visible = view.getVisibleSize();
        const screenSize = screen?.windowSize;
        // 取多源尺寸的最大值，保证全屏覆盖
        let sizeW = Math.max(
            hostUI?.contentSize?.width ?? 0,
            visible?.width ?? 0,
            screenSize?.width ?? 0,
            1920,
        );
        let sizeH = Math.max(
            hostUI?.contentSize?.height ?? 0,
            visible?.height ?? 0,
            screenSize?.height ?? 0,
            1080,
        );
        if (!Number.isFinite(sizeW) || sizeW <= 0) sizeW = 1920;
        if (!Number.isFinite(sizeH) || sizeH <= 0) sizeH = 1080;
        ui.setAnchorPoint(0.5, 0.5);
        ui.setContentSize(sizeW, sizeH);
        mask.setPosition(0, 0, 0);

        this._repaintBackdrop(mask, inst);

        // 吃掉触摸/鼠标事件，避免传给游戏或其他 UI；并支持“点遮罩空白处关闭”
        const instNow = FriendRankView._instance;
        const hitClose = (e: any): boolean => {
            try {
                const close = (instNow as any)?._closeNode as Node | null;
                if (!close || !close.isValid) return false;
                const ui = close.getComponent(UITransform);
                if (!ui || !ui.isValid) return false;
                const loc = e?.getUILocation ? e.getUILocation() : (e?.getLocation ? e.getLocation() : null);
                if (!loc) return false;
                const local = ui.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
                const size = ui.contentSize;
                return Math.abs(local.x) <= size.width / 2 && Math.abs(local.y) <= size.height / 2;
            } catch {
                return false;
            }
        };

        // Ensure stable handler references for reliable off/on
        if (!FriendRankView._onBackdropSwallow) {
            FriendRankView._onBackdropSwallow = (e: any) => {
                if (hitClose(e)) {
                    console.log('[FriendRankView] backdrop: allow pass to close');
                    return; // 允许点击穿透到关闭按钮
                }
                e?.stopPropagationImmediate?.();
                e?.stopPropagation?.();
            };
        }

        if (!FriendRankView._onBackdropClose) {
            FriendRankView._onBackdropClose = (e: any) => {
                if (hitClose(e)) {
                    console.log('[FriendRankView] backdrop close handler: click is on close, ignore');
                    return; // 允许点击穿透到关闭按钮
                }
                // 先吞事件，防止点穿
                e?.stopPropagationImmediate?.();
                e?.stopPropagation?.();

                // 如果点击在面板内容范围内，不关闭（用 UITransform 本地坐标做 hit-test，避免坐标系不一致）
                const loc: Vec2 | null = e?.getUILocation
                    ? e.getUILocation()
                    : (e?.getLocation ? e.getLocation() : null);

                if (loc && root && root.isValid) {
                    const uiRoot = root.getComponent(UITransform);
                    if (uiRoot) {
                        const local = uiRoot.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
                        const size = uiRoot.contentSize;

                        const left = -size.width * uiRoot.anchorPoint.x;
                        const right = left + size.width;
                        const bottom = -size.height * uiRoot.anchorPoint.y;
                        const top = bottom + size.height;

                        if (local.x >= left && local.x <= right && local.y >= bottom && local.y <= top) {
                            return;
                        }
                    }
                }

                // 允许关闭后再关闭（避免 show 当次点击/抬手立即关闭）
                if (instNow && (instNow as any)._canClose) {
                    FriendRankView.hide();
                }
            };
        }

        // 先移除旧监听（防止重复绑定）
        const swallowTypes = [
            Node.EventType.TOUCH_START,
            Node.EventType.TOUCH_MOVE,
            Node.EventType.TOUCH_CANCEL,
            Node.EventType.MOUSE_DOWN,
            Node.EventType.MOUSE_MOVE,
            Node.EventType.MOUSE_LEAVE,
        ];
        const swallowOnly = FriendRankView._onBackdropSwallow!;
        const closeOnBackdrop = FriendRankView._onBackdropClose!;

        swallowTypes.forEach(type => mask!.off(type, swallowOnly, this));
        swallowTypes.forEach(type => mask!.on(type, swallowOnly, this));

        // 结束事件也先吞掉，避免冒泡到其它 UI
        mask!.off(Node.EventType.TOUCH_END, swallowOnly, this);
        mask!.on(Node.EventType.TOUCH_END, swallowOnly, this);
        mask!.off(Node.EventType.MOUSE_UP, swallowOnly, this);
        mask!.on(Node.EventType.MOUSE_UP, swallowOnly, this);

        // 只在 TOUCH_END / MOUSE_UP 绑定关闭
        mask!.off(Node.EventType.TOUCH_END, closeOnBackdrop, this);
        mask!.on(Node.EventType.TOUCH_END, closeOnBackdrop, this);
        mask!.off(Node.EventType.MOUSE_UP, closeOnBackdrop, this);
        mask!.on(Node.EventType.MOUSE_UP, closeOnBackdrop, this);

        if (root && root.isValid && root.parent === host) {
            // 让遮罩在榜单之下、并把榜单置顶（避免 setSiblingIndex 越界）
            // 最终顺序：... 其它UI ... -> Backdrop -> FriendRankRoot(榜单)
            const end = host.children.length - 1;
            const close = (instNow as any)?._closeNode as Node | null;
            // 预留顶层给关闭按钮：Mask 次之，Root 居中，保证关闭按钮不会被遮罩盖住
            mask.setSiblingIndex(Math.max(0, end - (close ? 2 : 1)));
            root.setSiblingIndex(Math.max(0, end - (close ? 1 : 0)));
            if (close && close.isValid && close.parent === host) {
                close.setSiblingIndex(host.children.length - 1);
            }
        }

        return mask;
    }

    private static _repaintBackdrop(mask: Node, inst?: FriendRankView | null) {
        const g = mask.getComponent(Graphics) || mask.addComponent(Graphics);
        const opComp = mask.getComponent(UIOpacity) || mask.addComponent(UIOpacity);
        const c = (inst?.backdropColor || this._backdropColor || new Color(0, 0, 0, 160)).clone();
        const ui = mask.getComponent(UITransform);
        let size = ui ? ui.contentSize : view.getVisibleSize();
        if (!size || size.width <= 0 || size.height <= 0) {
            size = view.getVisibleSize();
        }
        g.clear();
        // 用 Graphics 绘制颜色，用 UIOpacity 控制透明度
        g.fillColor = new Color(c.r, c.g, c.b, 255);
        opComp.opacity = c.a;
        g.rect(-size.width / 2, -size.height / 2, size.width, size.height);
        g.fill();
    }

    // —— 按钮与位置统一入口 ——
    public static ensureButton(canvasHint?: Node | null): Node | null {
        const scene = director.getScene();
        if (!scene) return null;
        let canvas = canvasHint ?? scene.getChildByName('Canvas');
        if (!canvas) {
            canvas = new Node('Canvas');
            canvas.layer = Layers.Enum.UI_2D;
            const ui = canvas.addComponent(UITransform);
            const c = canvas.addComponent(Canvas);
            c.alignCanvasWithScreen = true;
            // 兜底尺寸，防止 0 尺寸导致布局异常
            ui.setContentSize(1920, 1080);
            scene.addChild(canvas);
        }
        let btn = this._buttonNode;
        const shouldReparent = btn && btn.isValid && btn.parent !== canvas;
        if (!btn || !btn.isValid || shouldReparent) {
            if (shouldReparent && btn && btn.isValid) {
                btn.removeFromParent();
            } else {
                btn = new Node('FriendRankButton');
                btn.layer = Layers.Enum.UI_2D;
                const ui = btn.addComponent(UITransform);
                ui.setContentSize(180, 60);
                const lab = btn.addComponent(Label);
                lab.string = '好友榜';
                lab.fontSize = 32;
                lab.lineHeight = 36;
                lab.color = new Color(255, 255, 255, 235);
                const anyLab: any = lab as any;
                anyLab.useOutline = true;
                anyLab.outlineColor = new Color(0, 0, 0, 255);
                anyLab.outlineWidth = 2;
                anyLab.useShadow = true;
                anyLab.shadowColor = new Color(0, 0, 0, 120);
                anyLab.shadowOffset = new Vec2(1, -1);
                anyLab.shadowBlur = 1;
            }
            btn.on(Input.EventType.TOUCH_START, (evt: any) => {
                evt?.stopPropagationImmediate?.();
                evt?.stopPropagation?.();
            }, this);
            btn.on(Input.EventType.MOUSE_DOWN, (evt: any) => {
                evt?.stopPropagationImmediate?.();
                evt?.stopPropagation?.();
            }, this);
            btn.on(Input.EventType.TOUCH_END, (evt: any) => {
                evt?.stopPropagation?.();
                this._handleButtonClick();
            }, this);
            btn.on(Input.EventType.MOUSE_UP, (evt: any) => {
                evt?.stopPropagation?.();
                this._handleButtonClick();
            }, this);
            canvas.addChild(btn);
            this._buttonNode = btn;
        }
        this._layoutButton(canvas);
        // 保证按钮在同层级的最上方，避免被遮罩挡住
        if (btn && btn.isValid && btn.parent) {
            btn.setSiblingIndex(btn.parent.children.length - 1);
        }
        this._bindResizeForButton();
        return btn ?? null;
    }

    // 供外部在创建遮罩后调用，确保按钮浮在遮罩之上
    public static bringButtonToFront(canvasHint?: Node | null): void {
        const scene = director.getScene();
        if (!scene) return;
        const canvas = canvasHint ?? scene.getChildByName('Canvas') ?? null;
        const btn = this.ensureButton(canvas);
        if (btn && btn.isValid && btn.parent) {
            btn.setSiblingIndex(btn.parent.children.length - 1);
        }
    }

    private static _layoutButton(canvas?: Node | null) {
        const btn = this._buttonNode;
        if (!btn || !btn.isValid) return;
        const vs = (() => { try { return view.getVisibleSize(); } catch { return null; } })();
        const scr = screen?.windowSize;
        const parentUI = (canvas ?? btn.parent)?.getComponent(UITransform);
        // 优先用实际可见尺寸，其次父级 UI，再兜底设计分辨率，避免取到放大后的大尺寸导致按钮跑出屏幕
        let w = vs?.width || parentUI?.contentSize?.width || scr?.width || 750;
        let h = vs?.height || parentUI?.contentSize?.height || scr?.height || 1334;
        w = Math.max(320, Math.min(w, 2000));
        h = Math.max(480, Math.min(h, 2600));
        const ui = btn.getComponent(UITransform) || btn.addComponent(UITransform);
        const s = Math.max(0.7, Math.min(1.05, Math.min(w / 750, h / 1334)));
        ui.setContentSize(180 * s, 60 * s);
        ui.setAnchorPoint(0, 1);

        const lab = btn.getComponent(Label);
        if (lab) {
            lab.fontSize = Math.round(28 * s);
            lab.lineHeight = Math.round(32 * s);
        }

        const marginX = Math.max(14, Math.min(60, this._btnMarginXBase * s));
        const marginY = Math.max(50, Math.min(140, this._btnMarginYBase * s));
        btn.setPosition(-w * 0.5 + marginX, h * 0.5 - marginY, 0);
    }

    private static _bindResizeForButton() {
        if (this._buttonResizeBound) return;
        this._buttonResizeBound = true;
        view.on('design-resolution-changed', () => {
            this._layoutButton();
        }, this);
    }

    private static _getWx(): any {
        if (typeof wx !== 'undefined') return wx;
        if (typeof window !== 'undefined' && (window as any).wx) return (window as any).wx;
        return null;
    }

    private static _handleButtonClick(): void {
        // 非微信环境直接显示，便于调试
        if (sys.platform !== sys.Platform.WECHAT_GAME) {
            try { this.show?.(); } catch (err) { console.warn('[FriendRank] show (non-wechat) failed', err); }
            return;
        }
        const wxAny = this._getWx();
        if (!wxAny) {
            console.warn('[FriendRank] wx not available');
            return;
        }
        const KEY = 'stack_friend_profile_granted';
        const granted = sys.localStorage.getItem(KEY);
        if (granted === '1') {
            try { this.show?.(); } catch (err) { console.warn('[FriendRank] show failed', err); }
            return;
        }
        wxAny.getUserProfile({
            desc: '用于展示好友排行榜',
            success: (_res: any) => {
                try { sys.localStorage.setItem(KEY, '1'); } catch {}
                try { this.show?.(); } catch (err) { console.warn('[FriendRank] show after auth failed', err); }
            },
            fail: (err: any) => {
                console.warn('[FriendRank] getUserProfile cancelled/failed', err);
            },
        });
    }
}
