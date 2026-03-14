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

export interface TimerState {
    running: boolean
    type: "study" | "break"
    startedAt: number // epoch ms
    /** Target for breaks (seconds), null for open-ended study timer */
    targetSeconds: number | null
    elapsed: number
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
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const LEVEL_TITLES: Record<number, string> = {
    1: "Erstsemester",
    2: "Student",
    3: "Fleissiger Student",
    4: "Tutor",
    5: "Stipendiat",
    6: "Wissenschaftler",
    7: "Dozent",
    8: "Forscher",
    9: "Dekan",
    10: "Professor",
    11: "Rektor",
    12: "Nobelpreisträger",
}

export function getLevelTitle(level: number): string {
    if (level >= 12) return LEVEL_TITLES[12]
    return LEVEL_TITLES[level] ?? LEVEL_TITLES[1]
}

export function xpForLevel(level: number): number {
    if (level <= 1) return 0
    return level * level * 50
}

export function levelFromXP(xp: number): number {
    return Math.max(1, Math.floor(Math.sqrt(xp / 50)))
}

export const EXCHANGE_RATES = [
    { label: "1:0.5", value: 0.5, description: "Grosszügig" },
    { label: "1:0.33", value: 0.333, description: "Entspannt" },
    { label: "1:0.25", value: 0.25, description: "Ausgewogen" },
    { label: "1:0.2", value: 0.2, description: "Diszipliniert" },
    { label: "1:0.1", value: 0.1, description: "Hardcore" },
]

// ── Achievements ──────────────────────────────────────────────────────────────

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
        id: "perfect_day", name: "Perfekter Tag", icon: "🌟",
        description: "Erledige alle Tasks eines Tages",
        xpReward: 30,
        check: () => false, // Checked manually via context flag
    },
    {
        id: "perfect_week", name: "Perfekte Woche", icon: "🏆",
        description: "7 Tage hintereinander 100%",
        xpReward: 75,
        check: (ctx) => ctx.streak >= 7,
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
        description: "1 Stunde am Stück gelernt",
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
        id: "five_hundred_tasks", name: "Unaufhaltbar", icon: "🚀",
        description: "Erledige 500 Tasks",
        xpReward: 250,
        check: (ctx) => ctx.totalTasksDone >= 500,
    },
]

// ── Plant stages ──────────────────────────────────────────────────────────────

export const PLANT_STAGES = [
    { minLevel: 1, name: "Samen", emoji: "🌰" },
    { minLevel: 2, name: "Keimling", emoji: "🌱" },
    { minLevel: 4, name: "Sprössling", emoji: "🌿" },
    { minLevel: 6, name: "Pflanze", emoji: "🪴" },
    { minLevel: 8, name: "Blume", emoji: "🌸" },
    { minLevel: 10, name: "Baum", emoji: "🌳" },
]

export function getPlantStage(level: number) {
    let stage = PLANT_STAGES[0]
    for (const s of PLANT_STAGES) {
        if (level >= s.minLevel) stage = s
    }
    return stage
}

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
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGamification(userId: string | null, streak: number) {
    const [state, setState] = useState<GamificationState>(DEFAULT_STATE)
    const [loaded, setLoaded] = useState(false)
    const [timerState, setTimerState] = useState<TimerState | null>(null)
    const timerIntervalRef = useRef<number>(0)
    const saveTimerRef = useRef<number>(0)

    // Notifications for parent (level-up, achievement unlocked)
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

    // ── Award XP on task completion ─────────────────────────────────────────────
    const onTaskDone = useCallback(
        (opts?: { allDayDone?: boolean; priority?: number }) => {
            update((prev) => {
                let xpGain = 10
                if (opts?.priority === 3) xpGain += 5 // High priority bonus
                if (streak > 0) xpGain += Math.min(streak * 2, 20) // Streak multiplier, capped at 20
                if (opts?.allDayDone) xpGain += 25 // All-day bonus

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

            // Check achievements after state update
            setTimeout(() => checkAchievements(), 100)
        },
        [update, streak, checkAchievements]
    )

    // ── Undo task done (XP correction) ─────────────────────────────────────────
    const onTaskUndone = useCallback(() => {
        update((prev) => ({
            ...prev,
            totalTasksDone: Math.max(0, prev.totalTasksDone - 1),
        }))
    }, [update])

    // ── Timer ───────────────────────────────────────────────────────────────────
    useEffect(() => {
        // Cleanup interval on unmount
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
                    // Study session completed! Award coins
                    const studyMinutes = prev.targetSeconds / 60
                    const coinsEarned = studyMinutes * state.exchangeRate
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
                    update((s) => ({
                        ...s,
                        coins: s.coins + coinsEarned,
                        totalStudyMinutes: s.totalStudyMinutes + studyMinutes,
                    }))
                    setTimeout(() => checkAchievements(), 100)
                    setNotifications((n) => [
                        ...n,
                        { type: "achievement", message: `🪙 +${coinsEarned.toFixed(1)} Pausenminuten verdient!`, id: `coins_${Date.now()}` },
                    ])
                    return { ...prev, elapsed, running: false }
                }
                return { ...prev, elapsed }
            })
        }, 1000)
    }, [timerState, state.exchangeRate, userId, update, checkAchievements])

    // stopStudyTimer removed – study timer auto-completes or is cancelled (no coins)

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
                        // Break done
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
        // Cancelling study or break = no reward, no refund
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

    // ── Weekly Challenge ────────────────────────────────────────────────────────
    const currentWeekKey = useMemo(() => {
        const now = new Date()
        const jan1 = new Date(now.getFullYear(), 0, 1)
        const weekNum = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
        return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`
    }, [])

    useEffect(() => {
        if (!loaded) return
        if (state.weeklyChallengeWeek === currentWeekKey) return
        // Generate new weekly challenge based on average
        const avgPerWeek = state.totalTasksDone > 0 ? Math.max(5, Math.round(state.totalTasksDone / 4)) : 10
        const target = Math.min(avgPerWeek + 3, avgPerWeek * 1.2) // Slightly above average
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
    const plantStage = useMemo(() => getPlantStage(state.level), [state.level])
    const levelTitle = useMemo(() => getLevelTitle(state.level), [state.level])

    // Format timer display – always countdown (remaining time)
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
        plantStage,
        levelTitle,
        currentWeekKey,

        // Actions
        onTaskDone,
        onTaskUndone,
        startStudyTimer,
        startBreakTimer,
        cancelTimer,
        setExchangeRate,
        checkAchievements,
        consumeNotification,
    }
}
