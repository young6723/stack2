import { sys } from 'cc';

export type DailyTaskType =
    | 'login'
    | 'play_count'
    | 'reach_layers'
    | 'perfect_stack'
    | 'reach_score';

export type TaskReward = {
    coins?: number;
};

export type DailyTaskConfig = {
    id: string;
    name: string;
    desc?: string;
    type: DailyTaskType;
    target_value: number;
    reward: TaskReward;
    sort_order: number;
    is_active: boolean;
};

export type DailyTaskProgress = {
    progress: number;
    claimed: boolean;
};

export type DailyTaskLocalState = {
    last_reset_at: number;
    tasks: Record<string, DailyTaskProgress>;
};

export type DailyTaskView = DailyTaskConfig & DailyTaskProgress & {
    is_completed: boolean;
};

export type ClaimResult = {
    ok: boolean;
    reason?: 'NOT_FOUND' | 'NOT_ACTIVE' | 'NOT_COMPLETE' | 'ALREADY_CLAIMED';
    reward?: TaskReward;
};

const DAILY_TASKS_STATE_KEY = 'daily_tasks_state_v3';

export class TaskManager {
    private static _instance: TaskManager | null = null;

    public static getInstance(): TaskManager {
        if (!TaskManager._instance) {
            TaskManager._instance = new TaskManager();
        }
        return TaskManager._instance;
    }

    private configs: DailyTaskConfig[] = [];
    private state: DailyTaskLocalState = {
        last_reset_at: 0,
        tasks: {},
    };

    private constructor() {}

    public init(configs: DailyTaskConfig[]): void {
        this.configs = configs
            .filter((t) => t.is_active)
            .sort((a, b) => a.sort_order - b.sort_order);

        this.loadState();
        this.ensureDailyReset();
        this.ensureTaskEntries();
        this.saveState();
    }

    public report(type: DailyTaskType, value: number = 1, mode: 'inc' | 'set-max' = 'inc'): void {
        if (this.configs.length === 0) return;

        for (const cfg of this.configs) {
            if (cfg.type !== type) continue;

            const taskState = this.state.tasks[cfg.id];
            if (!taskState || taskState.claimed) continue;

            if (mode === 'set-max') {
                taskState.progress = Math.max(taskState.progress, value);
            } else {
                taskState.progress += value;
            }
            taskState.progress = Math.min(taskState.progress, cfg.target_value);
        }

        this.saveState();
    }

    public claim(taskId: string): ClaimResult {
        const cfg = this.configs.find((t) => t.id === taskId);
        if (!cfg) return { ok: false, reason: 'NOT_FOUND' };
        if (!cfg.is_active) return { ok: false, reason: 'NOT_ACTIVE' };

        const taskState = this.state.tasks[taskId];
        if (!taskState) return { ok: false, reason: 'NOT_FOUND' };
        if (taskState.claimed) return { ok: false, reason: 'ALREADY_CLAIMED' };
        if (taskState.progress < cfg.target_value) return { ok: false, reason: 'NOT_COMPLETE' };

        taskState.claimed = true;
        this.saveState();
        return { ok: true, reward: cfg.reward };
    }

    public getTasks(): DailyTaskView[] {
        return this.configs.map((cfg) => {
            const taskState = this.state.tasks[cfg.id] ?? { progress: 0, claimed: false };
            const progress = Math.min(taskState.progress, cfg.target_value);
            return {
                ...cfg,
                progress,
                claimed: taskState.claimed,
                is_completed: progress >= cfg.target_value,
            };
        });
    }

    public getState(): DailyTaskLocalState {
        return JSON.parse(JSON.stringify(this.state)) as DailyTaskLocalState;
    }

    public forceResetToday(): void {
        this.resetTasksForToday(Date.now());
        this.saveState();
    }

    private ensureDailyReset(): void {
        if (this.state.last_reset_at === 0) {
            this.resetTasksForToday(Date.now());
            return;
        }

        const last = new Date(this.state.last_reset_at);
        const now = new Date();
        const hasCrossedDay = !this.isSameLocalDay(last, now);
        if (hasCrossedDay) {
            this.resetTasksForToday(now.getTime());
        }
    }

    private ensureTaskEntries(): void {
        const activeIds = new Set(this.configs.map((t) => t.id));

        for (const cfg of this.configs) {
            if (!this.state.tasks[cfg.id]) {
                this.state.tasks[cfg.id] = { progress: 0, claimed: false };
            }
        }

        for (const taskId of Object.keys(this.state.tasks)) {
            if (!activeIds.has(taskId)) {
                delete this.state.tasks[taskId];
            }
        }
    }

    private resetTasksForToday(resetAt: number): void {
        this.state.last_reset_at = resetAt;
        const newTasks: Record<string, DailyTaskProgress> = {};
        for (const cfg of this.configs) {
            newTasks[cfg.id] = { progress: 0, claimed: false };
        }
        this.state.tasks = newTasks;
    }

    private isSameLocalDay(a: Date, b: Date): boolean {
        return (
            a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate()
        );
    }

    private loadState(): void {
        try {
            const raw = sys.localStorage.getItem(DAILY_TASKS_STATE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw) as Partial<DailyTaskLocalState>;
            if (!parsed || typeof parsed !== 'object') return;

            const loadedLastResetAt =
                typeof parsed.last_reset_at === 'number' ? parsed.last_reset_at : 0;
            const loadedTasks = parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {};

            const normalizedTasks: Record<string, DailyTaskProgress> = {};
            for (const taskId in loadedTasks) {
                if (!Object.prototype.hasOwnProperty.call(loadedTasks, taskId)) continue;
                const taskState = (loadedTasks as Record<string, any>)[taskId];
                const progress =
                    typeof taskState?.progress === 'number' && Number.isFinite(taskState.progress)
                        ? Math.max(0, taskState.progress)
                        : 0;
                const claimed = Boolean(taskState?.claimed);
                normalizedTasks[taskId] = { progress, claimed };
            }

            this.state = {
                last_reset_at: loadedLastResetAt,
                tasks: normalizedTasks,
            };
        } catch (err) {
            console.warn('[TaskManager] Failed to load local state, fallback to defaults.', err);
            this.state = { last_reset_at: 0, tasks: {} };
        }
    }

    private saveState(): void {
        try {
            sys.localStorage.setItem(DAILY_TASKS_STATE_KEY, JSON.stringify(this.state));
        } catch (err) {
            console.warn('[TaskManager] Failed to save local state.', err);
        }
    }
}
