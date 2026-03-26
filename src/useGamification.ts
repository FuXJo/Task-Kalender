import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Achievement {
    id: string
    name: string
    description: string
    icon: string
    xpReward: number
    check: (ctx: AchievementContext) => boolean
}

export interface DailyChallenge {
    id: string
    name: string
    description: string
    icon: string
    xpReward: number
    check: (ctx: DailyChallengeContext) => boolean
}

export interface WeeklyChallenge {
    id: string
    name: string
    description: string
    icon: string
    xpReward: number
    check: (ctx: WeeklyChallengeContext) => boolean
}

export interface UnlockedAchievement {
    id: string
    unlockedAt: string
}

export interface AchievementContext {
    totalTasksDone: number
    streak: number
    bestStreak: number
    level: number
    totalStudyMinutes: number
    allCatsAt100: boolean
}

export interface DailyChallengeContext {
    tasksToday: number
    studyMinutesToday: number
    allDayDone: boolean
}

export interface WeeklyChallengeContext {
    tasksThisWeek: number
    studyMinutesThisWeek: number
    daysStudiedThisWeek: number
    streak: number
}

export interface TimerState {
    running: boolean
    type: "study" | "break"
    startedAt: number // epoch ms
    targetSeconds: number | null
    elapsed: number
}

// ── Casino Types ──────────────────────────────────────────────────────────────

export interface SlotResult {
    reels: string[] // 3 symbols
    bet: number
    winAmount: number
    xpWon: number
}

export interface HigherLowerState {
    active: boolean
    currentCard: number // 2-14
    currentSuit: string
    bet: number
    multiplier: number
    round: number // 1-5
    history: { card: number; suit: string }[]
}

export interface DailyChallengeState {
    id: string
    completed: boolean
    dateKey: string
}

export interface WeeklyChallengeState {
    id: string
    completed: boolean
    weekKey: string
}

export interface GamificationState {
    xp: number
    level: number
    coins: number
    streakFreezesUsed: number
    streakFreezeMonth: string
    bestStreak: number
    achievements: UnlockedAchievement[]
    exchangeRate: number
    weeklyChallengeTarget: number | null
    weeklyChallengeWeek: string
    totalStudyMinutes: number
    totalTasksDone: number
    todayStudyMinutes: number
    todayStudyDate: string
    lastWheelSpin: string // ISO date of last free spin
    casinoStats: { totalWon: number; totalLost: number; biggestWin: number }
    dailyChallenges: DailyChallengeState[]
    weeklyChallenges: WeeklyChallengeState[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const LEVEL_TITLES: Record<number, string> = {
    1: "Erstsemester",
    2: "Student",
    3: "Fleissiger Student",
    4: "Tutor",
    5: "Bibliotheks-Stammgast",
    6: "Stipendiat",
    7: "Wissenschaftler",
    8: "Laborleiter",
    9: "Dozent",
    10: "Forscher",
    11: "Assistenzprofessor",
    12: "Dekan",
    13: "Professor",
    14: "Fachbereichsleiter",
    15: "Institutsleiter",
    16: "Prorektor",
    17: "Rektor",
    18: "Emeritus",
    19: "Gastprofessor (Harvard)",
    20: "Fellow der Royal Society",
    21: "Akademie-Mitglied",
    22: "Forschungspionier",
    23: "Visionär",
    24: "Wissenschaftslegende",
    25: "Nobelpreiskandidat",
    26: "Nobelpreisträger",
    27: "Doppel-Nobelpreisträger",
    28: "Universalgenie",
    29: "Zeitloser Gelehrter",
    30: "Erleuchteter Meister",
}

export function getLevelTitle(level: number): string {
    if (level >= 30) return LEVEL_TITLES[30]
    return LEVEL_TITLES[level] ?? LEVEL_TITLES[1]
}

/** Progressive XP curve: grows faster at higher levels */
export function xpForLevel(level: number): number {
    if (level <= 1) return 0
    // Smooth progressive curve: 100, 250, 500, 800, 1200, 1700, ...
    return Math.round(50 * level * level + 50 * level - 100)
}

export function levelFromXP(xp: number): number {
    let lvl = 1
    while (lvl < 30 && xp >= xpForLevel(lvl + 1)) lvl++
    return lvl
}

export const EXCHANGE_RATES = [
    { label: "1:0.5", value: 0.5, emoji: "😌", description: "Chill-Modus" },
    { label: "1:0.33", value: 0.333, emoji: "☕", description: "Kaffeepause" },
    { label: "1:0.25", value: 0.25, emoji: "⚖️", description: "Ausgewogen" },
    { label: "1:0.2", value: 0.2, emoji: "💪", description: "Diszipliniert" },
    { label: "1:0.1", value: 0.1, emoji: "🔥", description: "Hardcore" },
]

// ── Achievements (permanent, one-time) ────────────────────────────────────────

export const ACHIEVEMENTS: Achievement[] = [
    {
        id: "first_task", name: "Erster Schritt", icon: "🎯",
        description: "Erledige deinen ersten Task",
        xpReward: 10,
        check: (ctx) => ctx.totalTasksDone >= 1,
    },
    {
        id: "ten_tasks", name: "Fleissig", icon: "📝",
        description: "Erledige 10 Tasks",
        xpReward: 25,
        check: (ctx) => ctx.totalTasksDone >= 10,
    },
    {
        id: "fifty_tasks", name: "Maschine", icon: "⚡",
        description: "Erledige 50 Tasks",
        xpReward: 50,
        check: (ctx) => ctx.totalTasksDone >= 50,
    },
    {
        id: "hundred_tasks", name: "Centurion", icon: "💯",
        description: "Erledige 100 Tasks",
        xpReward: 100,
        check: (ctx) => ctx.totalTasksDone >= 100,
    },
    {
        id: "five_hundred_tasks", name: "Unaufhaltbar", icon: "🚀",
        description: "Erledige 500 Tasks",
        xpReward: 250,
        check: (ctx) => ctx.totalTasksDone >= 500,
    },
    {
        id: "thousand_tasks", name: "Tausendster", icon: "🏛️",
        description: "Erledige 1000 Tasks",
        xpReward: 500,
        check: (ctx) => ctx.totalTasksDone >= 1000,
    },
    {
        id: "perfect_day", name: "Perfekter Tag", icon: "🌟",
        description: "Erledige alle Tasks eines Tages",
        xpReward: 30,
        check: () => false, // Checked manually
    },
    {
        id: "streak_7", name: "Woche am Stück", icon: "🔥",
        description: "7-Tage-Streak erreichen",
        xpReward: 50,
        check: (ctx) => ctx.bestStreak >= 7,
    },
    {
        id: "streak_30", name: "Marathonläufer", icon: "🏃",
        description: "30-Tage-Streak erreichen",
        xpReward: 150,
        check: (ctx) => ctx.bestStreak >= 30,
    },
    {
        id: "streak_100", name: "Legendär", icon: "👑",
        description: "100-Tage-Streak erreichen",
        xpReward: 500,
        check: (ctx) => ctx.bestStreak >= 100,
    },
    {
        id: "all_cats_100", name: "Kategorien-König", icon: "🎖️",
        description: "Alle Kategorien auf 100%",
        xpReward: 100,
        check: (ctx) => ctx.allCatsAt100,
    },
    {
        id: "study_1h", name: "Fokussiert", icon: "🧠",
        description: "1 Stunde Gesamtstudienzeit",
        xpReward: 30,
        check: (ctx) => ctx.totalStudyMinutes >= 60,
    },
    {
        id: "study_10h", name: "Lernathon", icon: "📚",
        description: "10 Stunden Gesamtstudienzeit",
        xpReward: 75,
        check: (ctx) => ctx.totalStudyMinutes >= 600,
    },
    {
        id: "study_50h", name: "Wissensdurst", icon: "🏺",
        description: "50 Stunden Gesamtstudienzeit",
        xpReward: 200,
        check: (ctx) => ctx.totalStudyMinutes >= 3000,
    },
    {
        id: "study_100h", name: "Zeitinvestor", icon: "⏳",
        description: "100 Stunden Gesamtstudienzeit",
        xpReward: 400,
        check: (ctx) => ctx.totalStudyMinutes >= 6000,
    },
    {
        id: "level_5", name: "Aufsteiger", icon: "⬆️",
        description: "Level 5 erreichen",
        xpReward: 50,
        check: (ctx) => ctx.level >= 5,
    },
    {
        id: "level_10", name: "Meister", icon: "🎓",
        description: "Level 10 erreichen",
        xpReward: 100,
        check: (ctx) => ctx.level >= 10,
    },
    {
        id: "level_20", name: "Grossmeister", icon: "🏆",
        description: "Level 20 erreichen",
        xpReward: 300,
        check: (ctx) => ctx.level >= 20,
    },
    {
        id: "level_30", name: "Erleuchtung", icon: "✨",
        description: "Level 30 erreichen",
        xpReward: 1000,
        check: (ctx) => ctx.level >= 30,
    },
]

// ── Daily Challenges (rotate daily) ──────────────────────────────────────────

export const DAILY_CHALLENGE_POOL: DailyChallenge[] = [
    {
        id: "daily_1_task", name: "Tagesstart", icon: "☀️",
        description: "Erledige mindestens 1 Task",
        xpReward: 5,
        check: (ctx) => ctx.tasksToday >= 1,
    },
    {
        id: "daily_3_tasks", name: "Drei auf einen Streich", icon: "🎯",
        description: "Erledige 3 Tasks heute",
        xpReward: 10,
        check: (ctx) => ctx.tasksToday >= 3,
    },
    {
        id: "daily_5_tasks", name: "Fleissig heute", icon: "📋",
        description: "Erledige 5 Tasks heute",
        xpReward: 15,
        check: (ctx) => ctx.tasksToday >= 5,
    },
    {
        id: "daily_all_done", name: "Alles erledigt", icon: "✅",
        description: "Schliesse alle heutigen Tasks ab",
        xpReward: 20,
        check: (ctx) => ctx.allDayDone && ctx.tasksToday > 0,
    },
    {
        id: "daily_study_15", name: "Kurze Lernrunde", icon: "📖",
        description: "Lerne mindestens 15 Minuten",
        xpReward: 10,
        check: (ctx) => ctx.studyMinutesToday >= 15,
    },
    {
        id: "daily_study_30", name: "Halbe Stunde", icon: "⏰",
        description: "Lerne mindestens 30 Minuten",
        xpReward: 15,
        check: (ctx) => ctx.studyMinutesToday >= 30,
    },
    {
        id: "daily_study_60", name: "Power-Stunde", icon: "💪",
        description: "Lerne mindestens 60 Minuten heute",
        xpReward: 25,
        check: (ctx) => ctx.studyMinutesToday >= 60,
    },
    {
        id: "daily_study_120", name: "Lernmarathon", icon: "🏃",
        description: "Lerne mindestens 2 Stunden heute",
        xpReward: 40,
        check: (ctx) => ctx.studyMinutesToday >= 120,
    },
]

/** Select 3 daily challenges based on the date (deterministic) */
export function getDailyChallenges(dateKey: string): DailyChallenge[] {
    // Use a simple hash of the date string to shuffle consistently
    let hash = 0
    for (let i = 0; i < dateKey.length; i++) hash = ((hash << 5) - hash + dateKey.charCodeAt(i)) | 0

    // Always include "daily_1_task" as the baseline
    const baseline = DAILY_CHALLENGE_POOL[0]
    const rest = DAILY_CHALLENGE_POOL.slice(1)

    // Pick 2 more from the rest, offset by hash
    const absHash = Math.abs(hash)
    const pick1 = rest[absHash % rest.length]
    const pick2 = rest[(absHash + 3) % rest.length]

    // Avoid duplicates
    const selected = [baseline, pick1]
    if (pick2.id !== pick1.id) selected.push(pick2)
    else selected.push(rest[(absHash + 5) % rest.length])

    return selected
}

// ── Weekly Challenges (rotate weekly) ────────────────────────────────────────

export const WEEKLY_CHALLENGE_POOL: WeeklyChallenge[] = [
    {
        id: "weekly_10_tasks", name: "Wochen-Warm-up", icon: "🎯",
        description: "Erledige 10 Tasks diese Woche",
        xpReward: 25,
        check: (ctx) => ctx.tasksThisWeek >= 10,
    },
    {
        id: "weekly_25_tasks", name: "Produktive Woche", icon: "📊",
        description: "Erledige 25 Tasks diese Woche",
        xpReward: 50,
        check: (ctx) => ctx.tasksThisWeek >= 25,
    },
    {
        id: "weekly_study_2h", name: "Lernwoche", icon: "📚",
        description: "Lerne 2 Stunden diese Woche",
        xpReward: 30,
        check: (ctx) => ctx.studyMinutesThisWeek >= 120,
    },
    {
        id: "weekly_study_5h", name: "Intensivwoche", icon: "🔥",
        description: "Lerne 5 Stunden diese Woche",
        xpReward: 60,
        check: (ctx) => ctx.studyMinutesThisWeek >= 300,
    },
    {
        id: "weekly_5_days", name: "Konsistent", icon: "📅",
        description: "Lerne an 5 verschiedenen Tagen",
        xpReward: 40,
        check: (ctx) => ctx.daysStudiedThisWeek >= 5,
    },
    {
        id: "weekly_streak_keep", name: "Streak halten", icon: "🔗",
        description: "Halte deinen Streak die ganze Woche",
        xpReward: 35,
        check: (ctx) => ctx.streak >= 7,
    },
]

/** Select 2 weekly challenges based on the week key (deterministic) */
export function getWeeklyChallenges(weekKey: string): WeeklyChallenge[] {
    let hash = 0
    for (let i = 0; i < weekKey.length; i++) hash = ((hash << 5) - hash + weekKey.charCodeAt(i)) | 0
    const absHash = Math.abs(hash)
    const pick1 = WEEKLY_CHALLENGE_POOL[absHash % WEEKLY_CHALLENGE_POOL.length]
    let pick2 = WEEKLY_CHALLENGE_POOL[(absHash + 2) % WEEKLY_CHALLENGE_POOL.length]
    if (pick2.id === pick1.id) pick2 = WEEKLY_CHALLENGE_POOL[(absHash + 4) % WEEKLY_CHALLENGE_POOL.length]
    return [pick1, pick2]
}

// ── Casino Constants ──────────────────────────────────────────────────────────

export const SLOT_SYMBOLS = [
    { symbol: "🍒", weight: 30 },
    { symbol: "🍋", weight: 25 },
    { symbol: "🔔", weight: 20 },
    { symbol: "⭐", weight: 15 },
    { symbol: "💎", weight: 8 },
    { symbol: "🎰", weight: 2 },
]

export const SLOT_BETS = [1, 2, 5, 10]

export const WHEEL_SEGMENTS = [
    { label: "1 🪙", coins: 1, xp: 0, color: "#6b7280" },
    { label: "5 XP", coins: 0, xp: 5, color: "#3b82f6" },
    { label: "3 🪙", coins: 3, xp: 0, color: "#22c55e" },
    { label: "10 XP", coins: 0, xp: 10, color: "#8b5cf6" },
    { label: "5 🪙", coins: 5, xp: 0, color: "#f59e0b" },
    { label: "25 XP", coins: 0, xp: 25, color: "#ec4899" },
    { label: "10 🪙", coins: 10, xp: 0, color: "#ef4444" },
    { label: "Niete", coins: 0, xp: 0, color: "#374151" },
]

export const CARD_SUITS = ["♠️", "♥️", "♣️", "♦️"]
export const CARD_VALUES: Record<number, string> = {
    2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
    11: "J", 12: "Q", 13: "K", 14: "A",
}
export const HL_BETS = [1, 2, 5, 10]

// ── Default state ─────────────────────────────────────────────────────────────

const DEFAULT_STATE: GamificationState = {
    xp: 0,
    level: 1,
    coins: 0,
    streakFreezesUsed: 0,
    streakFreezeMonth: "",
    bestStreak: 0,
    achievements: [],
    exchangeRate: 0.25,
    weeklyChallengeTarget: null,
    weeklyChallengeWeek: "",
    totalStudyMinutes: 0,
    totalTasksDone: 0,
    todayStudyMinutes: 0,
    todayStudyDate: "",
    lastWheelSpin: "",
    casinoStats: { totalWon: 0, totalLost: 0, biggestWin: 0 },
    dailyChallenges: [],
    weeklyChallenges: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function weekKey(): string {
    const now = new Date()
    const jan1 = new Date(now.getFullYear(), 0, 1)
    const weekNum = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
    return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGamification(userId: string | null, streak: number) {
    const [state, setState] = useState<GamificationState>(DEFAULT_STATE)
    const [loaded, setLoaded] = useState(false)
    const [timerState, setTimerState] = useState<TimerState | null>(null)
    const timerIntervalRef = useRef<number>(0)
    const saveTimerRef = useRef<number>(0)

    const [notifications, setNotifications] = useState<Array<{ type: "level_up" | "achievement"; message: string; id: string }>>([])

    const consumeNotification = useCallback(() => {
        setNotifications((prev) => prev.slice(1))
    }, [])

    // ── Load from Supabase ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!userId) {
            setState(DEFAULT_STATE)
            setLoaded(false)
            return
        }
        const load = async () => {
            const { data } = await supabase
                .from("user_gamification")
                .select("*")
                .eq("user_id", userId)
                .single()

            if (data) {
                setState({
                    xp: data.xp ?? 0,
                    level: data.level ?? 1,
                    coins: data.coins ?? 0,
                    streakFreezesUsed: data.streak_freezes_used ?? 0,
                    streakFreezeMonth: data.streak_freeze_month ?? "",
                    bestStreak: data.best_streak ?? 0,
                    achievements: (data.achievements as UnlockedAchievement[]) ?? [],
                    exchangeRate: data.exchange_rate ?? 0.25,
                    weeklyChallengeTarget: data.weekly_challenge_target,
                    weeklyChallengeWeek: data.weekly_challenge_week ?? "",
                    totalStudyMinutes: data.total_study_minutes ?? 0,
                    totalTasksDone: data.total_tasks_done ?? 0,
                    todayStudyMinutes: data.today_study_minutes ?? 0,
                    todayStudyDate: data.today_study_date ?? "",
                    lastWheelSpin: data.last_wheel_spin ?? "",
                    casinoStats: (data.casino_stats as { totalWon: number; totalLost: number; biggestWin: number }) ?? { totalWon: 0, totalLost: 0, biggestWin: 0 },
                    dailyChallenges: (data.daily_challenges as DailyChallengeState[]) ?? [],
                    weeklyChallenges: (data.weekly_challenges as WeeklyChallengeState[]) ?? [],
                })
            }
            setLoaded(true)
        }
        load()
    }, [userId])

    // ── Save to Supabase (debounced) ────────────────────────────────────────────
    const saveToDb = useCallback(
        (newState: GamificationState) => {
            if (!userId) return
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = window.setTimeout(async () => {
                await supabase
                    .from("user_gamification")
                    .upsert(
                        {
                            user_id: userId,
                            xp: newState.xp,
                            level: newState.level,
                            coins: newState.coins,
                            streak_freezes_used: newState.streakFreezesUsed,
                            streak_freeze_month: newState.streakFreezeMonth,
                            best_streak: newState.bestStreak,
                            achievements: newState.achievements,
                            exchange_rate: newState.exchangeRate,
                            weekly_challenge_target: newState.weeklyChallengeTarget,
                            weekly_challenge_week: newState.weeklyChallengeWeek,
                            total_study_minutes: newState.totalStudyMinutes,
                            total_tasks_done: newState.totalTasksDone,
                            today_study_minutes: newState.todayStudyMinutes,
                            today_study_date: newState.todayStudyDate,
                            last_wheel_spin: newState.lastWheelSpin,
                            casino_stats: newState.casinoStats,
                            daily_challenges: newState.dailyChallenges,
                            weekly_challenges: newState.weeklyChallenges,
                            updated_at: new Date().toISOString(),
                        },
                        { onConflict: "user_id" }
                    )
            }, 500)
        },
        [userId]
    )

    // ── Update helper ───────────────────────────────────────────────────────────
    const update = useCallback(
        (fn: (prev: GamificationState) => GamificationState) => {
            setState((prev) => {
                const next = fn(prev)
                saveToDb(next)
                return next
            })
        },
        [saveToDb]
    )

    // ── Update best streak ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!loaded) return
        if (streak > state.bestStreak) {
            update((s) => ({ ...s, bestStreak: streak }))
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [streak, loaded])

    // ── Reset daily study if new day ────────────────────────────────────────────
    useEffect(() => {
        if (!loaded) return
        const today = todayKey()
        if (state.todayStudyDate !== today) {
            update((s) => ({ ...s, todayStudyMinutes: 0, todayStudyDate: today }))
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded])

    // (plant unlock effect removed – casino system replaces it)

    // ── Check achievements ──────────────────────────────────────────────────────
    const checkAchievements = useCallback(
        (extraCtx?: Partial<AchievementContext>) => {
            setState((prev) => {
                const ctx: AchievementContext = {
                    totalTasksDone: prev.totalTasksDone,
                    streak,
                    bestStreak: Math.max(prev.bestStreak, streak),
                    level: prev.level,
                    totalStudyMinutes: prev.totalStudyMinutes,
                    allCatsAt100: false,
                    ...extraCtx,
                }

                const unlockedIds = new Set(prev.achievements.map((a) => a.id))
                const newlyUnlocked: UnlockedAchievement[] = []
                let bonusXP = 0

                for (const ach of ACHIEVEMENTS) {
                    if (unlockedIds.has(ach.id)) continue
                    if (ach.check(ctx)) {
                        newlyUnlocked.push({ id: ach.id, unlockedAt: new Date().toISOString() })
                        bonusXP += ach.xpReward
                        setNotifications((n) => [
                            ...n,
                            { type: "achievement", message: `${ach.icon} ${ach.name} freigeschaltet!`, id: ach.id },
                        ])
                    }
                }

                if (newlyUnlocked.length === 0) return prev

                const newXP = prev.xp + bonusXP
                const newLevel = levelFromXP(newXP)
                const leveledUp = newLevel > prev.level

                if (leveledUp) {
                    setNotifications((n) => [
                        ...n,
                        { type: "level_up", message: `⬆️ Level ${newLevel}: ${getLevelTitle(newLevel)}!`, id: `level_${newLevel}` },
                    ])
                }

                const next: GamificationState = {
                    ...prev,
                    xp: newXP,
                    level: newLevel,
                    achievements: [...prev.achievements, ...newlyUnlocked],
                }
                saveToDb(next)
                return next
            })
        },
        [streak, saveToDb]
    )

    // ── Check daily challenges ──────────────────────────────────────────────────
    const checkDailyChallenges = useCallback(
        (ctx: DailyChallengeContext) => {
            const today = todayKey()
            const todayChallenges = getDailyChallenges(today)

            setState((prev) => {
                let bonusXP = 0
                const updatedDailies = todayChallenges.map((ch) => {
                    const existing = prev.dailyChallenges.find((d) => d.id === ch.id && d.dateKey === today)
                    if (existing?.completed) return existing
                    if (ch.check(ctx)) {
                        bonusXP += ch.xpReward
                        setNotifications((n) => [
                            ...n,
                            { type: "achievement", message: `${ch.icon} Tages-Challenge: ${ch.name}!`, id: `daily_${ch.id}_${today}` },
                        ])
                        return { id: ch.id, completed: true, dateKey: today }
                    }
                    return { id: ch.id, completed: false, dateKey: today }
                })

                if (bonusXP === 0) {
                    return { ...prev, dailyChallenges: updatedDailies }
                }

                const newXP = prev.xp + bonusXP
                const newLevel = levelFromXP(newXP)
                if (newLevel > prev.level) {
                    setNotifications((n) => [
                        ...n,
                        { type: "level_up", message: `⬆️ Level ${newLevel}: ${getLevelTitle(newLevel)}!`, id: `level_${newLevel}` },
                    ])
                }

                const next = { ...prev, xp: newXP, level: newLevel, dailyChallenges: updatedDailies }
                saveToDb(next)
                return next
            })
        },
        [saveToDb]
    )

    // ── Check weekly challenges ─────────────────────────────────────────────────
    const checkWeeklyChallenges = useCallback(
        (ctx: WeeklyChallengeContext) => {
            const wk = weekKey()
            const wkChallenges = getWeeklyChallenges(wk)

            setState((prev) => {
                let bonusXP = 0
                const updatedWeeklies = wkChallenges.map((ch) => {
                    const existing = prev.weeklyChallenges.find((w) => w.id === ch.id && w.weekKey === wk)
                    if (existing?.completed) return existing
                    if (ch.check(ctx)) {
                        bonusXP += ch.xpReward
                        setNotifications((n) => [
                            ...n,
                            { type: "achievement", message: `${ch.icon} Wochen-Challenge: ${ch.name}!`, id: `weekly_${ch.id}_${wk}` },
                        ])
                        return { id: ch.id, completed: true, weekKey: wk }
                    }
                    return { id: ch.id, completed: false, weekKey: wk }
                })

                if (bonusXP === 0) {
                    return { ...prev, weeklyChallenges: updatedWeeklies }
                }

                const newXP = prev.xp + bonusXP
                const newLevel = levelFromXP(newXP)
                if (newLevel > prev.level) {
                    setNotifications((n) => [
                        ...n,
                        { type: "level_up", message: `⬆️ Level ${newLevel}: ${getLevelTitle(newLevel)}!`, id: `level_${newLevel}` },
                    ])
                }

                const next = { ...prev, xp: newXP, level: newLevel, weeklyChallenges: updatedWeeklies }
                saveToDb(next)
                return next
            })
        },
        [saveToDb]
    )

    // ── Award XP on task completion ─────────────────────────────────────────────
    const onTaskDone = useCallback(
        (opts?: { allDayDone?: boolean; priority?: number; tasksToday?: number }) => {
            update((prev) => {
                let xpGain = 10
                if (opts?.priority === 3) xpGain += 5
                if (streak > 0) xpGain += Math.min(streak * 2, 20)
                if (opts?.allDayDone) xpGain += 25

                const newXP = prev.xp + xpGain
                const newLevel = levelFromXP(newXP)
                const leveledUp = newLevel > prev.level
                const newTotalDone = prev.totalTasksDone + 1

                if (leveledUp) {
                    setNotifications((n) => [
                        ...n,
                        { type: "level_up", message: `⬆️ Level ${newLevel}: ${getLevelTitle(newLevel)}!`, id: `level_${newLevel}` },
                    ])
                }

                return {
                    ...prev,
                    xp: newXP,
                    level: newLevel,
                    totalTasksDone: newTotalDone,
                }
            })

            // Check permanent achievements
            setTimeout(() => checkAchievements(), 100)

            // Check daily challenges
            setTimeout(() => {
                checkDailyChallenges({
                    tasksToday: opts?.tasksToday ?? 1,
                    studyMinutesToday: state.todayStudyMinutes,
                    allDayDone: opts?.allDayDone ?? false,
                })
            }, 200)
        },
        [update, streak, checkAchievements, checkDailyChallenges, state.todayStudyMinutes]
    )

    // ── Undo task done ──────────────────────────────────────────────────────────
    const onTaskUndone = useCallback(() => {
        update((prev) => ({
            ...prev,
            totalTasksDone: Math.max(0, prev.totalTasksDone - 1),
        }))
    }, [update])

    // ── Casino: Spin Wheel (daily free spin) ──────────────────────────────────
    const wheelAvailable = state.lastWheelSpin !== todayKey()

    const spinWheel = useCallback(() => {
        if (state.lastWheelSpin === todayKey()) return null
        const idx = Math.floor(Math.random() * WHEEL_SEGMENTS.length)
        const segment = WHEEL_SEGMENTS[idx]
        update((s) => {
            const newXP = s.xp + segment.xp
            const newLevel = levelFromXP(newXP)
            if (newLevel > s.level) {
                setNotifications((n) => [...n, { type: "level_up", message: `⬆️ Level ${newLevel}: ${getLevelTitle(newLevel)}!`, id: `level_${newLevel}` }])
            }
            return {
                ...s,
                coins: s.coins + segment.coins,
                xp: newXP,
                level: newLevel,
                lastWheelSpin: todayKey(),
                casinoStats: {
                    ...s.casinoStats,
                    totalWon: s.casinoStats.totalWon + segment.coins,
                    biggestWin: Math.max(s.casinoStats.biggestWin, segment.coins),
                },
            }
        })
        return { segmentIndex: idx, segment }
    }, [state.lastWheelSpin, update])

    // ── Casino: Slot Machine ─────────────────────────────────────────────
    const spinSlots = useCallback((bet: number): SlotResult | null => {
        if (state.coins < bet) return null
        // Weighted random pick
        const totalWeight = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0)
        const pickSymbol = () => {
            let r = Math.random() * totalWeight
            for (const s of SLOT_SYMBOLS) {
                r -= s.weight
                if (r <= 0) return s.symbol
            }
            return SLOT_SYMBOLS[0].symbol
        }
        const reels = [pickSymbol(), pickSymbol(), pickSymbol()]
        let winAmount = 0
        let xpWon = 0
        if (reels[0] === reels[1] && reels[1] === reels[2]) {
            // Jackpot: 3 matching
            const symbolIdx = SLOT_SYMBOLS.findIndex((s) => s.symbol === reels[0])
            const multiplier = [3, 5, 8, 12, 20, 50][symbolIdx] ?? 5
            winAmount = bet * multiplier
            xpWon = bet * 5
        } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
            // Small win: 2 matching
            winAmount = bet * 2
            xpWon = bet
        }
        const result: SlotResult = { reels, bet, winAmount, xpWon }
        update((s) => {
            const netGain = winAmount - bet
            const newXP = s.xp + xpWon
            const newLevel = levelFromXP(newXP)
            if (newLevel > s.level) {
                setNotifications((n) => [...n, { type: "level_up", message: `⬆️ Level ${newLevel}: ${getLevelTitle(newLevel)}!`, id: `level_${newLevel}` }])
            }
            return {
                ...s,
                coins: s.coins + netGain,
                xp: newXP,
                level: newLevel,
                casinoStats: {
                    totalWon: s.casinoStats.totalWon + (netGain > 0 ? netGain : 0),
                    totalLost: s.casinoStats.totalLost + (netGain < 0 ? Math.abs(netGain) : 0),
                    biggestWin: Math.max(s.casinoStats.biggestWin, winAmount),
                },
            }
        })
        return result
    }, [state.coins, update])

    // ── Casino: Higher/Lower ────────────────────────────────────────────
    const [hlState, setHlState] = useState<HigherLowerState>({
        active: false, currentCard: 7, currentSuit: "♠️", bet: 0, multiplier: 1, round: 0, history: [],
    })

    const randomCard = () => ({ card: Math.floor(Math.random() * 13) + 2, suit: CARD_SUITS[Math.floor(Math.random() * 4)] })

    const startHigherLower = useCallback((bet: number) => {
        if (state.coins < bet || hlState.active) return
        update((s) => ({ ...s, coins: s.coins - bet }))
        const first = randomCard()
        setHlState({ active: true, currentCard: first.card, currentSuit: first.suit, bet, multiplier: 1, round: 1, history: [first] })
    }, [state.coins, hlState.active, update])

    const guessHigherLower = useCallback((guess: "higher" | "lower"): { won: boolean; newCard: { card: number; suit: string } } | null => {
        if (!hlState.active) return null
        const next = randomCard()
        const isHigher = next.card > hlState.currentCard
        const isEqual = next.card === hlState.currentCard
        const correct = isEqual || (guess === "higher" ? isHigher : !isHigher)
        if (!correct) {
            // Lost everything
            update((s) => ({
                ...s,
                casinoStats: { ...s.casinoStats, totalLost: s.casinoStats.totalLost + hlState.bet },
            }))
            setHlState((s) => ({ ...s, active: false, history: [...s.history, next] }))
            setNotifications((n) => [...n, { type: "achievement", message: `💥 Verloren! ${CARD_VALUES[next.card]}${next.suit}`, id: `hl_lose_${Date.now()}` }])
            return { won: false, newCard: next }
        }
        const newMultiplier = hlState.multiplier * 1.5
        const newRound = hlState.round + 1
        if (newRound > 5) {
            // Auto cashout at round 5
            const winAmount = Math.round(hlState.bet * newMultiplier * 10) / 10
            update((s) => {
                const newXP = s.xp + Math.round(winAmount)
                const newLevel = levelFromXP(newXP)
                return {
                    ...s,
                    coins: s.coins + winAmount,
                    xp: newXP,
                    level: newLevel,
                    casinoStats: {
                        ...s.casinoStats,
                        totalWon: s.casinoStats.totalWon + winAmount,
                        biggestWin: Math.max(s.casinoStats.biggestWin, winAmount),
                    },
                }
            })
            setHlState((s) => ({ ...s, active: false, history: [...s.history, next] }))
            setNotifications((n) => [...n, { type: "achievement", message: `🎉 Max-Gewinn! +${Math.round(hlState.bet * newMultiplier)} Coins!`, id: `hl_max_${Date.now()}` }])
            return { won: true, newCard: next }
        }
        setHlState((s) => ({ ...s, currentCard: next.card, currentSuit: next.suit, multiplier: newMultiplier, round: newRound, history: [...s.history, next] }))
        return { won: true, newCard: next }
    }, [hlState, update])

    const cashOutHigherLower = useCallback(() => {
        if (!hlState.active || hlState.round <= 1) return
        const winAmount = Math.round(hlState.bet * hlState.multiplier * 10) / 10
        update((s) => {
            const xpWon = Math.round(winAmount / 2)
            const newXP = s.xp + xpWon
            const newLevel = levelFromXP(newXP)
            return {
                ...s,
                coins: s.coins + winAmount,
                xp: newXP,
                level: newLevel,
                casinoStats: {
                    ...s.casinoStats,
                    totalWon: s.casinoStats.totalWon + winAmount,
                    biggestWin: Math.max(s.casinoStats.biggestWin, winAmount),
                },
            }
        })
        setNotifications((n) => [...n, { type: "achievement", message: `💰 Ausgecasht! +${Math.round(hlState.bet * hlState.multiplier)} Coins!`, id: `hl_cash_${Date.now()}` }])
        setHlState((s) => ({ ...s, active: false }))
    }, [hlState, update])

    // ── Timer ───────────────────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        }
    }, [])

    const startStudyTimer = useCallback((durationMinutes: number) => {
        if (timerState?.running) return
        if (durationMinutes <= 0) return
        setTimerState({
            running: true,
            type: "study",
            startedAt: Date.now(),
            targetSeconds: durationMinutes * 60,
            elapsed: 0,
        })
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = window.setInterval(() => {
            setTimerState((prev) => {
                if (!prev || !prev.running) return prev
                const elapsed = Math.floor((Date.now() - prev.startedAt) / 1000)
                if (prev.targetSeconds && elapsed >= prev.targetSeconds) {
                    clearInterval(timerIntervalRef.current)
                    const studyMinutes = prev.targetSeconds / 60
                    const coinsEarned = studyMinutes * state.exchangeRate
                    const timerXP = Math.round(studyMinutes) // 1 XP per minute
                    if (userId) {
                        supabase.from("timer_sessions").insert({
                            user_id: userId,
                            type: "study",
                            started_at: new Date(prev.startedAt).toISOString(),
                            duration_minutes: studyMinutes,
                            coins_earned: coinsEarned,
                            completed: true,
                        })
                    }
                    update((s) => {
                        const newXP = s.xp + timerXP
                        const newLevel = levelFromXP(newXP)
                        const newTodayMins = s.todayStudyMinutes + studyMinutes
                        if (newLevel > s.level) {
                            setNotifications((n) => [
                                ...n,
                                { type: "level_up", message: `⬆️ Level ${newLevel}: ${getLevelTitle(newLevel)}!`, id: `level_${newLevel}` },
                            ])
                        }
                        return {
                            ...s,
                            xp: newXP,
                            level: newLevel,
                            coins: s.coins + coinsEarned,
                            totalStudyMinutes: s.totalStudyMinutes + studyMinutes,
                            todayStudyMinutes: newTodayMins,
                            todayStudyDate: todayKey(),
                        }
                    })
                    setTimeout(() => checkAchievements(), 100)
                    setNotifications((n) => [
                        ...n,
                        { type: "achievement", message: `🪙 +${coinsEarned.toFixed(1)} Pausenmin & +${timerXP} XP verdient!`, id: `coins_${Date.now()}` },
                    ])
                    // Check daily challenges after study
                    setTimeout(() => {
                        checkDailyChallenges({
                            tasksToday: 0,
                            studyMinutesToday: state.todayStudyMinutes + studyMinutes,
                            allDayDone: false,
                        })
                    }, 300)
                    return { ...prev, elapsed, running: false }
                }
                return { ...prev, elapsed }
            })
        }, 1000)
    }, [timerState, state.exchangeRate, state.todayStudyMinutes, userId, update, checkAchievements, checkDailyChallenges])

    const startBreakTimer = useCallback(
        (breakMinutes: number) => {
            if (timerState?.running) return
            if (state.coins < breakMinutes) return
            update((prev) => ({ ...prev, coins: prev.coins - breakMinutes }))
            setTimerState({
                running: true,
                type: "break",
                startedAt: Date.now(),
                targetSeconds: breakMinutes * 60,
                elapsed: 0,
            })
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
            timerIntervalRef.current = window.setInterval(() => {
                setTimerState((prev) => {
                    if (!prev || !prev.running) return prev
                    const elapsed = Math.floor((Date.now() - prev.startedAt) / 1000)
                    if (prev.targetSeconds && elapsed >= prev.targetSeconds) {
                        clearInterval(timerIntervalRef.current)
                        if (userId) {
                            supabase.from("timer_sessions").insert({
                                user_id: userId,
                                type: "break",
                                started_at: new Date(prev.startedAt).toISOString(),
                                duration_minutes: prev.targetSeconds / 60,
                                coins_earned: -(prev.targetSeconds / 60),
                                completed: true,
                            })
                        }
                        return { ...prev, elapsed, running: false }
                    }
                    return { ...prev, elapsed }
                })
            }, 1000)
        },
        [timerState, state.coins, userId, update]
    )

    const cancelTimer = useCallback(() => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        if (timerState?.type === "study" && timerState.running && userId) {
            supabase.from("timer_sessions").insert({
                user_id: userId,
                type: "study",
                started_at: new Date(timerState.startedAt).toISOString(),
                duration_minutes: timerState.elapsed / 60,
                coins_earned: 0,
                completed: false,
            })
        }
        setTimerState(null)
    }, [timerState, userId])

    // ── Exchange rate ───────────────────────────────────────────────────────────
    const setExchangeRate = useCallback(
        (rate: number) => {
            update((prev) => ({ ...prev, exchangeRate: rate }))
        },
        [update]
    )

    // ── Weekly Challenge (legacy target) ────────────────────────────────────────
    const currentWeekKey = useMemo(() => weekKey(), [])

    useEffect(() => {
        if (!loaded) return
        if (state.weeklyChallengeWeek === currentWeekKey) return
        const avgPerWeek = state.totalTasksDone > 0 ? Math.max(5, Math.round(state.totalTasksDone / 4)) : 10
        const target = Math.min(avgPerWeek + 3, avgPerWeek * 1.2)
        update((prev) => ({
            ...prev,
            weeklyChallengeTarget: Math.round(target),
            weeklyChallengeWeek: currentWeekKey,
        }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded, currentWeekKey])

    // ── Computed values ─────────────────────────────────────────────────────────
    const xpForNext = useMemo(() => xpForLevel(state.level + 1), [state.level])
    const xpForCurrent = useMemo(() => xpForLevel(state.level), [state.level])
    const xpProgress = useMemo(
        () => (xpForNext - xpForCurrent > 0 ? (state.xp - xpForCurrent) / (xpForNext - xpForCurrent) : 0),
        [state.xp, xpForCurrent, xpForNext]
    )
    const levelTitle = useMemo(() => getLevelTitle(state.level), [state.level])

    // Daily/Weekly challenge instances for current day/week
    const currentDailyChallenges = useMemo(() => getDailyChallenges(todayKey()), [])
    const currentWeeklyChallenges = useMemo(() => getWeeklyChallenges(currentWeekKey), [currentWeekKey])

    // Timer display – always countdown
    const timerDisplay = useMemo(() => {
        if (!timerState) return ""
        if (timerState.targetSeconds) {
            const remaining = Math.max(0, timerState.targetSeconds - timerState.elapsed)
            const m = Math.floor(remaining / 60)
            const s = remaining % 60
            return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        }
        return "00:00"
    }, [timerState])

    return {
        // State
        ...state,
        loaded,
        timerState,
        timerDisplay,
        notifications,

        // Computed
        xpForNext,
        xpProgress,
        levelTitle,
        currentWeekKey,
        currentDailyChallenges,
        currentWeeklyChallenges,

        // Actions
        onTaskDone,
        onTaskUndone,
        startStudyTimer,
        startBreakTimer,
        cancelTimer,
        setExchangeRate,
        checkAchievements,
        checkDailyChallenges,
        checkWeeklyChallenges,
        consumeNotification,
        // Casino
        wheelAvailable,
        spinWheel,
        spinSlots,
        hlState,
        startHigherLower,
        guessHigherLower,
        cashOutHigherLower,
    }
}
