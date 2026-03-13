import { sys } from 'cc';

export type SkinRarity = 'basic' | 'rare' | 'epic' | 'special';

export type SkinColorProfile = {
    hue_start: number;
    hue_step: number;
    sat_base: number;
    sat_var: number;
    light_base: number;
    light_var: number;
    level_brighten: number;
    background_sat_scale?: number;
    background_light_boost?: number;
};

export type SkinConfig = {
    id: string;
    name: string;
    rarity: SkinRarity;
    price: number;
    is_default?: boolean;
    profile: SkinColorProfile;
};

type SkinState = {
    owned_ids: string[];
    equipped_id: string;
};

export type SkinView = SkinConfig & {
    owned: boolean;
    equipped: boolean;
};

export type PurchaseSkinResult = {
    ok: boolean;
    reason?: 'NOT_FOUND' | 'ALREADY_OWNED' | 'INSUFFICIENT_FUNDS';
    state?: SkinState;
};

const SKIN_STATE_KEY = 'stack_skin_state_v1';

export class SkinManager {
    private static _instance: SkinManager | null = null;

    public static getInstance(): SkinManager {
        if (!SkinManager._instance) {
            SkinManager._instance = new SkinManager();
        }
        return SkinManager._instance;
    }

    private configs: SkinConfig[] = [];
    private state: SkinState = {
        owned_ids: [],
        equipped_id: '',
    };

    private constructor() {}

    public init(configs: SkinConfig[]): void {
        this.configs = configs.slice();
        this.loadState();
        this.ensureDefaults();
        this.saveState();
    }

    public getSkins(rarity?: SkinRarity): SkinView[] {
        const owned = new Set(this.state.owned_ids);
        return this.configs
            .filter((skin) => !rarity || skin.rarity === rarity)
            .map((skin) => ({
                ...skin,
                owned: owned.has(skin.id),
                equipped: skin.id === this.state.equipped_id,
            }));
    }

    public getEquippedSkin(): SkinConfig {
        return this.getSkinById(this.state.equipped_id) ?? this.getDefaultSkin();
    }

    public getSkinById(id: string): SkinConfig | null {
        return this.configs.find((skin) => skin.id === id) ?? null;
    }

    public isOwned(id: string): boolean {
        return this.state.owned_ids.indexOf(id) >= 0;
    }

    public equip(id: string): boolean {
        const skin = this.getSkinById(id);
        if (!skin || !this.isOwned(id)) return false;
        this.state.equipped_id = id;
        this.saveState();
        return true;
    }

    public purchase(id: string, diamonds: number): PurchaseSkinResult {
        const skin = this.getSkinById(id);
        if (!skin) return { ok: false, reason: 'NOT_FOUND' };
        if (this.isOwned(id)) return { ok: false, reason: 'ALREADY_OWNED' };
        if (diamonds < skin.price) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };

        this.state.owned_ids.push(id);
        this.state.equipped_id = id;
        this.saveState();
        return { ok: true, state: this.getState() };
    }

    public getState(): SkinState {
        return {
            owned_ids: this.state.owned_ids.slice(),
            equipped_id: this.state.equipped_id,
        };
    }

    private getDefaultSkin(): SkinConfig {
        return (
            this.configs.find((skin) => skin.is_default) ??
            this.configs[0] ?? {
                id: 'default',
                name: 'Classic',
                rarity: 'basic',
                price: 0,
                is_default: true,
                profile: {
                    hue_start: 160,
                    hue_step: 10,
                    sat_base: 0.58,
                    sat_var: 0.10,
                    light_base: 0.62,
                    light_var: 0.06,
                    level_brighten: 0.002,
                },
            }
        );
    }

    private ensureDefaults(): void {
        const defaultSkin = this.getDefaultSkin();
        const owned = new Set(this.state.owned_ids);
        owned.add(defaultSkin.id);
        this.state.owned_ids = this.configs
            .map((skin) => skin.id)
            .filter((id) => owned.has(id));

        if (!this.state.equipped_id || !this.isOwned(this.state.equipped_id)) {
            this.state.equipped_id = defaultSkin.id;
        }
    }

    private loadState(): void {
        try {
            const raw = sys.localStorage.getItem(SKIN_STATE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as Partial<SkinState>;
            if (!parsed || typeof parsed !== 'object') return;

            const owned_ids = Array.isArray(parsed.owned_ids)
                ? parsed.owned_ids.filter((id): id is string => typeof id === 'string')
                : [];
            const equipped_id = typeof parsed.equipped_id === 'string' ? parsed.equipped_id : '';

            this.state = { owned_ids, equipped_id };
        } catch (err) {
            console.warn('[SkinManager] Failed to load local skin state.', err);
            this.state = { owned_ids: [], equipped_id: '' };
        }
    }

    private saveState(): void {
        try {
            sys.localStorage.setItem(SKIN_STATE_KEY, JSON.stringify(this.state));
        } catch (err) {
            console.warn('[SkinManager] Failed to save local skin state.', err);
        }
    }
}
