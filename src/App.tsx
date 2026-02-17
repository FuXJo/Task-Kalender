import React, { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Plus, Trash2, Tag, CalendarDays, List, Pencil, GripHorizontal, Sun, Moon, Flame, BarChart2 } from "lucide-react"

import { supabase } from "@/lib/supabase"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type ISODate = string

type DbTask = {
  id: string
  user_id: string
  date: ISODate
  title: string
  category: string | null
  done: boolean
  created_at: string | null

  priority: number
  repeat_every_days: number | null
  repeat_until: string | null

  sort_order: number
}

// Drag payload
const DND_MIME = "application/x-taskkalender"
type DragPayload =
  | { kind: "move"; taskId: string; fromISO: ISODate }
  | { kind: "reorder"; taskId: string; fromISO: ISODate }

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseISODate(iso: ISODate): Date {
  const [y, m, dd] = iso.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, dd ?? 1)
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}

function normalizeCategory(s: string) {
  return (s ?? "").trim()
}

function percent(r: number) {
  return Math.round(r * 100)
}

function msUntilNextLocalMidnight() {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
  return next.getTime() - now.getTime()
}

function dayCompletion(tasks: DbTask[] | undefined) {
  const total = (tasks ?? []).length
  const done = (tasks ?? []).reduce((a, t) => a + (t.done ? 1 : 0), 0)
  const ratio = total === 0 ? 0 : done / total
  return { total, done, ratio }
}

// NUR Vergangenheit färben. Heute + Zukunft immer weiß.
function dayStatusClass(
  iso: ISODate,
  todayISO: ISODate,
  tasks: DbTask[] | undefined
): { border: string; bg: string; tone: "none" | "red" | "yellow" | "green" } {
  if (iso >= todayISO) {
    return { border: "border-border", bg: "bg-background", tone: "none" }
  }

  const { total, ratio } = dayCompletion(tasks)
  if (total === 0) return { border: "border-border", bg: "bg-background", tone: "none" }

  if (ratio >= 1) return { border: "border-emerald-400/70", bg: "bg-emerald-400/15", tone: "green" }
  if (ratio >= 0.5) return { border: "border-amber-400/70", bg: "bg-amber-400/15", tone: "yellow" }
  return { border: "border-rose-400/70", bg: "bg-rose-400/15", tone: "red" }
}

function mapTasksByDate(rows: DbTask[]) {
  const m: Record<ISODate, DbTask[]> = {}
  for (const t of rows) {
    const iso = t.date
    if (!m[iso]) m[iso] = []
    m[iso].push(t)
  }
  return m
}

function uniqueCategoriesFromTasks(tasksByDate: Record<ISODate, DbTask[]>) {
  const set = new Set<string>()
  for (const tasks of Object.values(tasksByDate)) {
    for (const t of tasks ?? []) {
      const c = normalizeCategory(t.category ?? "")
      if (c) set.add(c)
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export default function App() {
  // Auth
  const [authReady, setAuthReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  // Minimal Login UI
  const [authEmail, setAuthEmail] = useState("")
  const [authPass, setAuthPass] = useState("")
  const [authMsg, setAuthMsg] = useState("")

  // Forgot/reset mail request UI
  const [resetMode, setResetMode] = useState(false)
  const [resetMsg, setResetMsg] = useState("")

  // Recovery UI (set new password)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [newPass1, setNewPass1] = useState("")
  const [newPass2, setNewPass2] = useState("")
  const [recoveryMsg, setRecoveryMsg] = useState("")

  // Data
  const [tasksByDate, setTasksByDate] = useState<Record<ISODate, DbTask[]>>({})
  const [categories, setCategories] = useState<string[]>([])

  const [todayISO, setTodayISO] = useState<ISODate>(() => toISODate(new Date()))
  useEffect(() => {
    let t: number | undefined

    const schedule = () => {
      t = window.setTimeout(() => {
        setTodayISO(toISODate(new Date()))
        schedule()
      }, msUntilNextLocalMidnight())
    }

    schedule()

    return () => {
      if (t !== undefined) window.clearTimeout(t)
    }
  }, [])

  const [cursorMonth, setCursorMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [selectedISO, setSelectedISO] = useState<ISODate>(() => toISODate(new Date()))

  // Add Task Dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newCategory, setNewCategory] = useState<string>("__none__")
  const [newHighPriority, setNewHighPriority] = useState(false)

  // Edit Task Dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editTaskId, setEditTaskId] = useState<string>("")
  const [editTitle, setEditTitle] = useState("")
  const [editCategory, setEditCategory] = useState<string>("__none__")
  const [editHighPriority, setEditHighPriority] = useState(false)

  // Category management UI
  const [newCategoryName, setNewCategoryName] = useState("")
  const [renameFrom, setRenameFrom] = useState<string>("")
  const [renameTo, setRenameTo] = useState<string>("")

  // Drag helpers (calendar move + reorder in list)
  const [dragOverISO, setDragOverISO] = useState<ISODate | "">("")
  const dragRef = useRef<DragPayload | null>(null)

  const [dragOverTaskId, setDragOverTaskId] = useState<string>("")
  const [dragPos, setDragPos] = useState<"above" | "below">("above")

  // Month cells
  const monthCells = useMemo(() => {
    const start = startOfMonth(cursorMonth)
    const end = endOfMonth(cursorMonth)

    const weekdayMon0 = (d: Date) => (d.getDay() + 6) % 7
    const startPad = weekdayMon0(start)
    const totalDays = end.getDate()

    const cells: Array<{ iso: ISODate; day: number; inMonth: boolean }> = []

    const prevMonthEnd = new Date(start.getFullYear(), start.getMonth(), 0)
    for (let i = startPad - 1; i >= 0; i--) {
      const day = prevMonthEnd.getDate() - i
      const d = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), day)
      cells.push({ iso: toISODate(d), day, inMonth: false })
    }

    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(start.getFullYear(), start.getMonth(), day)
      cells.push({ iso: toISODate(d), day, inMonth: true })
    }

    while (cells.length % 7 !== 0) {
      const last = parseISODate(cells[cells.length - 1].iso)
      const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
      cells.push({ iso: toISODate(d), day: d.getDate(), inMonth: false })
    }

    return cells
  }, [cursorMonth])

  const visibleRange = useMemo(() => {
    if (monthCells.length === 0) {
      const t = toISODate(new Date())
      return { from: t, to: t }
    }
    return { from: monthCells[0].iso, to: monthCells[monthCells.length - 1].iso }
  }, [monthCells])

  const monthLabel = cursorMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })
  const selectedTasks = tasksByDate[selectedISO] ?? []

  const selectedDateLabel = useMemo(() => {
    return parseISODate(selectedISO).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }, [selectedISO])

  // Sort helper used for display + reorder logic
  const sortForDisplay = (a: DbTask, b: DbTask) => {
    const dDone = Number(a.done) - Number(b.done)
    if (dDone !== 0) return dDone

    const pa = a.priority ?? 1
    const pb = b.priority ?? 1
    if (pb !== pa) return pb - pa

    const soA = a.sort_order ?? 0
    const soB = b.sort_order ?? 0
    if (soA !== soB) return soA - soB

    const ca = (a.category ?? "").trim().toLowerCase()
    const cb = (b.category ?? "").trim().toLowerCase()
    return ca.localeCompare(cb)
  }

  const getSortedDayTasks = (iso: ISODate) => (tasksByDate[iso] ?? []).slice().sort(sortForDisplay)

  // Auth bootstrap + Recovery session takeover (FIX für Redirect/Login auf Vercel)
  useEffect(() => {
    const boot = async () => {
      if (typeof window !== "undefined") {
        const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash
        const hp = new URLSearchParams(hash)

        const typeH = hp.get("type")
        const access_token = hp.get("access_token")
        const refresh_token = hp.get("refresh_token")

        if (typeH === "recovery" && access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (!error) {
            setRecoveryMode(true)
            setRecoveryMsg("")
            history.replaceState(null, "", window.location.pathname + window.location.search)
          }
        }

        const qp = new URLSearchParams(window.location.search)
        const code = qp.get("code")
        const typeQ = qp.get("type")

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (!error) {
            if (typeQ === "recovery") {
              setRecoveryMode(true)
              setRecoveryMsg("")
            }
            history.replaceState(null, "", window.location.pathname)
          }
        }
      }

      const { data: sessionData } = await supabase.auth.getSession()
      setUserId(sessionData.session?.user?.id ?? null)
      setAuthReady(true)
    }

    boot()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true)
        setRecoveryMsg("")
      }
      setUserId(session?.user?.id ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Load tasks for current visible month range (USER-FILTER!)
  const loadVisibleTasks = async () => {
    if (!userId) return
    const { from, to } = visibleRange

    const { data, error } = await supabase
      .from("tasks")
      .select("id,user_id,date,title,category,done,created_at,priority,repeat_every_days,repeat_until,sort_order")
      .eq("user_id", userId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("sort_order", { ascending: true })

    if (error) return

    const rows = (data ?? []) as DbTask[]
    const mapped = mapTasksByDate(rows)
    setTasksByDate(mapped)
    setCategories(uniqueCategoriesFromTasks(mapped))
  }

  useEffect(() => {
    if (!userId) {
      setTasksByDate({})
      setCategories([])
      return
    }
    if (recoveryMode) return
    loadVisibleTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, visibleRange.from, visibleRange.to, recoveryMode])

  // Auth actions
  const signIn = async () => {
    setAuthMsg("")
    setResetMsg("")
    setRecoveryMsg("")
    const email = authEmail.trim()
    const password = authPass
    if (!email || !password) return

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setAuthMsg(error.message)
  }

  const signUp = async () => {
    setAuthMsg("")
    setResetMsg("")
    setRecoveryMsg("")
    const email = authEmail.trim()
    const password = authPass
    if (!email || !password) return

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) setAuthMsg(error.message)
  }

  const requestPasswordReset = async () => {
    setAuthMsg("")
    setResetMsg("")
    const email = authEmail.trim()
    if (!email) return

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}`,
    })

    if (error) setResetMsg(error.message)
    else setResetMsg("E-Mail gesendet! Bitte schau in dein Postfach.")
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setAuthEmail("")
    setAuthPass("")
    setAuthMsg("")
    setResetMsg("")
    setResetMode(false)
  }

  const updatePassword = async () => {
    setRecoveryMsg("")
    const p1 = newPass1
    const p2 = newPass2

    if (!p1 || p1.length < 6) {
      setRecoveryMsg("Passwort zu kurz (min. 6).")
      return
    }
    if (p1 !== p2) {
      setRecoveryMsg("Passwörter stimmen nicht überein.")
      return
    }

    const { error } = await supabase.auth.updateUser({ password: p1 })
    if (error) {
      setRecoveryMsg(error.message)
      return
    }

    await supabase.auth.signOut()

    setRecoveryMode(false)
    setNewPass1("")
    setNewPass2("")
    setRecoveryMsg("Passwort gesetzt. Jetzt einloggen.")
  }

  // Task CRUD
  function ensureCategory(nameRaw: string) {
    const name = normalizeCategory(nameRaw)
    if (!name) return
    setCategories((prev) => (prev.includes(name) ? prev : [...prev, name].sort((a, b) => a.localeCompare(b))))
  }

  const addTask = async () => {
    if (!userId) return
    const title = newTitle.trim()
    if (!title) return

    const cat = newCategory === "__none__" ? null : normalizeCategory(newCategory)
    if (cat) ensureCategory(cat)

    const { data, error } = await supabase
      .from("tasks")
      .insert([
        {
          user_id: userId,
          date: selectedISO,
          title,
          category: cat,
          done: false,
          priority: newHighPriority ? 2 : 1,
          repeat_every_days: null,
          repeat_until: null,
          sort_order: Math.floor(Date.now() / 1000),
        },
      ])
      .select("id,user_id,date,title,category,done,created_at,priority,repeat_every_days,repeat_until,sort_order")
      .single()

    if (error || !data) return

    const row = data as DbTask
    setTasksByDate((prev) => {
      const list = prev[row.date] ?? []
      return { ...prev, [row.date]: [...list, row] }
    })

    setNewTitle("")
    setNewCategory("__none__")
    setNewHighPriority(false)
    setAddDialogOpen(false)
  }

  const toggleTask = async (taskId: string) => {
    if (!userId) return
    const dayList = tasksByDate[selectedISO] ?? []
    const cur = dayList.find((t) => t.id === taskId)
    if (!cur) return

    const nextDone = !cur.done

    setTasksByDate((prev) => {
      const list = prev[selectedISO] ?? []
      return { ...prev, [selectedISO]: list.map((t) => (t.id === taskId ? { ...t, done: nextDone } : t)) }
    })

    const { error } = await supabase.from("tasks").update({ done: nextDone }).eq("id", taskId).eq("user_id", userId)
    if (error) {
      setTasksByDate((prev) => {
        const list = prev[selectedISO] ?? []
        return { ...prev, [selectedISO]: list.map((t) => (t.id === taskId ? { ...t, done: !nextDone } : t)) }
      })
    }
  }

  const deleteTask = async (taskId: string) => {
    if (!userId) return
    const snapshot = tasksByDate[selectedISO] ?? []

    setTasksByDate((prev) => {
      const list = prev[selectedISO] ?? []
      const next = list.filter((t) => t.id !== taskId)
      const m = { ...prev, [selectedISO]: next }
      if (next.length === 0) delete m[selectedISO]
      return m
    })

    const { error } = await supabase.from("tasks").delete().eq("id", taskId).eq("user_id", userId)
    if (error) setTasksByDate((prev) => ({ ...prev, [selectedISO]: snapshot }))
  }

  const openEditTask = (task: DbTask) => {
    setEditTaskId(task.id)
    setEditTitle(task.title)
    setEditCategory(task.category ? task.category : "__none__")
    setEditHighPriority((task.priority ?? 1) >= 2)
    setEditDialogOpen(true)
  }

  const saveEditTask = async () => {
    if (!userId) return
    const title = editTitle.trim()
    if (!title) return

    const cat = editCategory === "__none__" ? null : normalizeCategory(editCategory)
    if (cat) ensureCategory(cat)

    const list = tasksByDate[selectedISO] ?? []
    const before = list.find((t) => t.id === editTaskId)
    if (!before) return

    const nextPriority = editHighPriority ? 2 : 1

    setTasksByDate((prev) => {
      const l = prev[selectedISO] ?? []
      return {
        ...prev,
        [selectedISO]: l.map((t) => (t.id === editTaskId ? { ...t, title, category: cat, priority: nextPriority } : t)),
      }
    })

    const { error } = await supabase
      .from("tasks")
      .update({ title, category: cat, priority: nextPriority })
      .eq("id", editTaskId)
      .eq("user_id", userId)

    if (error) {
      setTasksByDate((prev) => {
        const l = prev[selectedISO] ?? []
        return { ...prev, [selectedISO]: l.map((t) => (t.id === editTaskId ? before : t)) }
      })
      return
    }

    setEditDialogOpen(false)
    setEditTaskId("")
    setEditTitle("")
    setEditCategory("__none__")
    setEditHighPriority(false)
  }

  const renormalizeGroup = async (iso: ISODate, done: boolean, priority: number) => {
    const day = getSortedDayTasks(iso)
    const group = day.filter((t) => Number(t.done) === Number(done) && (t.priority ?? 1) === (priority ?? 1))

    const updates = group.map((t, i) => ({ id: t.id, sort_order: (i + 1) * 1000 }))

    setTasksByDate((prev) => {
      const list = prev[iso] ?? []
      const m = new Map(updates.map((u) => [u.id, u.sort_order]))
      return {
        ...prev,
        [iso]: list.map((t) => (m.has(t.id) ? { ...t, sort_order: m.get(t.id)! } : t)),
      }
    })

    await Promise.all(
      updates.map((u) => supabase.from("tasks").update({ sort_order: u.sort_order }).eq("id", u.id).eq("user_id", userId!))
    )
  }

  const applyReorderWithinDay = async (taskId: string, overId: string, pos: "above" | "below") => {
    if (!userId) return
    if (!taskId || !overId || taskId === overId) return

    const day = getSortedDayTasks(selectedISO)
    const moved = day.find((t) => t.id === taskId)
    const over = day.find((t) => t.id === overId)
    if (!moved || !over) return

    const sameGroup = Number(moved.done) === Number(over.done) && (moved.priority ?? 1) === (over.priority ?? 1)
    if (!sameGroup) return

    const groupDone = moved.done
    const groupPriority = moved.priority ?? 1

    const group = day.filter((t) => Number(t.done) === Number(groupDone) && (t.priority ?? 1) === groupPriority)

    const fromIdx = group.findIndex((t) => t.id === taskId)
    const toIdxRaw = group.findIndex((t) => t.id === overId)
    if (fromIdx === -1 || toIdxRaw === -1) return

    const groupWithout = group.filter((t) => t.id !== taskId)
    const baseIdx = groupWithout.findIndex((t) => t.id === overId)
    const insertIdx = pos === "above" ? baseIdx : baseIdx + 1

    const prev = groupWithout[insertIdx - 1]
    const next = groupWithout[insertIdx]

    const prevOrder = prev?.sort_order ?? null
    const nextOrder = next?.sort_order ?? null

    let newOrder: number
    if (prevOrder === null && nextOrder === null) newOrder = 1000
    else if (prevOrder === null) newOrder = (nextOrder as number) - 1000
    else if (nextOrder === null) newOrder = prevOrder + 1000
    else {
      if (nextOrder - prevOrder <= 1) {
        await renormalizeGroup(selectedISO, groupDone, groupPriority)
        const day2 = getSortedDayTasks(selectedISO)
        const group2 = day2.filter((t) => Number(t.done) === Number(groupDone) && (t.priority ?? 1) === groupPriority)

        const group2Without = group2.filter((t) => t.id !== taskId)
        const base2 = group2Without.findIndex((t) => t.id === overId)
        const insert2 = pos === "above" ? base2 : base2 + 1

        const prev2 = group2Without[insert2 - 1]
        const next2 = group2Without[insert2]
        const p2 = prev2?.sort_order ?? null
        const n2 = next2?.sort_order ?? null

        if (p2 === null && n2 === null) newOrder = 1000
        else if (p2 === null) newOrder = (n2 as number) - 1000
        else if (n2 === null) newOrder = p2 + 1000
        else newOrder = Math.floor((p2 + n2) / 2)
      } else {
        newOrder = Math.floor((prevOrder + nextOrder) / 2)
      }
    }

    // lokal setzen
    setTasksByDate((prev) => {
      const list = prev[selectedISO] ?? []
      return {
        ...prev,
        [selectedISO]: list.map((t) => (t.id === taskId ? { ...t, sort_order: newOrder } : t)),
      }
    })

    const { error } = await supabase.from("tasks").update({ sort_order: newOrder }).eq("id", taskId).eq("user_id", userId)
    if (error) loadVisibleTasks()
  }

  const moveTask = async (fromISO: ISODate, toISO: ISODate, taskId: string) => {
    if (!userId) return
    if (!fromISO || !toISO || fromISO === toISO) return

    const fromList = tasksByDate[fromISO] ?? []
    const task = fromList.find((t) => t.id === taskId)
    if (!task) return

    const newSort = Math.floor(Date.now() / 1000)

    setTasksByDate((prev) => {
      const a = prev[fromISO] ?? []
      const b = prev[toISO] ?? []
      const nextFrom = a.filter((t) => t.id !== taskId)
      const nextTo = [...b, { ...task, date: toISO, sort_order: newSort }]
      const m = { ...prev, [fromISO]: nextFrom, [toISO]: nextTo }
      if (nextFrom.length === 0) delete m[fromISO]
      return m
    })

    const { error } = await supabase
      .from("tasks")
      .update({ date: toISO, sort_order: newSort })
      .eq("id", taskId)
      .eq("user_id", userId)

    if (error) loadVisibleTasks()
  }

  // Category management (via updating tasks) - USER FILTER!
  const addCategoryFromInput = () => {
    const name = normalizeCategory(newCategoryName)
    if (!name) return
    ensureCategory(name)
    setNewCategoryName("")
  }

  const deleteCategory = async (category: string) => {
    const cat = normalizeCategory(category)
    if (!cat || !userId) return

    await supabase.from("tasks").update({ category: null }).eq("user_id", userId).eq("category", cat)
    await loadVisibleTasks()

    if (newCategory === cat) setNewCategory("__none__")
    if (editCategory === cat) setEditCategory("__none__")
  }

  const renameCategory = async (oldName: string, newNameRaw: string) => {
    const from = normalizeCategory(oldName)
    const to = normalizeCategory(newNameRaw)
    if (!from || !to || from === to || !userId) return

    await supabase.from("tasks").update({ category: to }).eq("user_id", userId).eq("category", from)
    await loadVisibleTasks()

    if (newCategory === from) setNewCategory(to)
    if (editCategory === from) setEditCategory(to)
  }

  // Drag helpers
  function setDragPayload(e: React.DragEvent, payload: DragPayload) {
    dragRef.current = payload
    try {
      e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
    } catch {}
    try {
      e.dataTransfer.setData("text/plain", JSON.stringify(payload))
    } catch {}
    e.dataTransfer.effectAllowed = "move"
  }

  function readDragPayload(e: React.DragEvent): DragPayload | null {
    if (dragRef.current) return dragRef.current

    try {
      const rawA = e.dataTransfer.getData(DND_MIME)
      const rawB = e.dataTransfer.getData("text/plain")
      const raw = rawA || rawB
      if (!raw) return null
      const p = JSON.parse(raw) as DragPayload
      if (!p?.taskId || !p?.fromISO || !p?.kind) return null
      return p
    } catch {
      return null
    }
  }

  // Stats
  const categoryStats = useMemo(() => {
    const acc: Record<string, { total: number; done: number }> = {}
    for (const c of categories) acc[c] = { total: 0, done: 0 }
    acc[""] = acc[""] ?? { total: 0, done: 0 }

    for (const tasks of Object.values(tasksByDate)) {
      for (const t of tasks ?? []) {
        const c = normalizeCategory(t.category ?? "")
        if (c !== "" && !acc[c]) acc[c] = { total: 0, done: 0 }
        acc[c].total += 1
        if (t.done) acc[c].done += 1
      }
    }

    const rows = Object.entries(acc)
      .map(([category, v]) => ({
        category,
        label: category === "" ? "–" : category,
        total: v.total,
        done: v.done,
        ratio: v.total === 0 ? 0 : v.done / v.total,
      }))
      .filter((r) => r.total > 0 && r.category !== "")
      .sort((a, b) => a.label.localeCompare(b.label))

    return { rows }
  }, [tasksByDate, categories])

  // ── Dark Mode ──────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("darkMode") === "true" ||
        (!localStorage.getItem("darkMode") && window.matchMedia("(prefers-color-scheme: dark)").matches)
    }
    return false
  })

  useEffect(() => {
    const root = document.documentElement
    if (darkMode) {
      root.classList.add("dark")
      localStorage.setItem("darkMode", "true")
    } else {
      root.classList.remove("dark")
      localStorage.setItem("darkMode", "false")
    }
  }, [darkMode])

  // ── Streak ─────────────────────────────────────────────────────────────────
  const streak = useMemo(() => {
    let count = 0
    const cursor = new Date()
    cursor.setDate(cursor.getDate() - 1)
    while (true) {
      const iso = toISODate(cursor)
      const tasks = tasksByDate[iso]
      if (!tasks || tasks.length === 0) break
      const { ratio } = dayCompletion(tasks)
      if (ratio < 1) break
      count++
      cursor.setDate(cursor.getDate() - 1)
    }
    const todayTasks = tasksByDate[todayISO]
    if (todayTasks && todayTasks.length > 0 && dayCompletion(todayTasks).ratio >= 1) count++
    return count
  }, [tasksByDate, todayISO])

  // ── Wochenansicht ──────────────────────────────────────────────────────────
  const [calView, setCalView] = useState<"month" | "week" | "year">("month")

  const yearCells = useMemo(() => {
    const year = cursorMonth.getFullYear()
    return Array.from({ length: 12 }, (_, i) => {
      const monthStart = new Date(year, i, 1)
      const monthEnd = new Date(year, i + 1, 0)
      const days: ISODate[] = []
      for (let d = 1; d <= monthEnd.getDate(); d++) {
        days.push(toISODate(new Date(year, i, d)))
      }
      const totalAll = days.reduce((s, iso) => s + (tasksByDate[iso]?.length ?? 0), 0)
      const doneAll  = days.reduce((s, iso) => s + (tasksByDate[iso]?.filter(t => t.done).length ?? 0), 0)
      const ratio = totalAll === 0 ? 0 : doneAll / totalAll
      return { monthIndex: i, year, label: monthStart.toLocaleDateString("de-DE", { month: "long" }), short: monthStart.toLocaleDateString("de-DE", { month: "short" }), total: totalAll, done: doneAll, ratio }
    })
  }, [cursorMonth, tasksByDate])

  const weekCells = useMemo(() => {
    const today = parseISODate(selectedISO)
    const dow = (today.getDay() + 6) % 7
    const monday = new Date(today)
    monday.setDate(today.getDate() - dow)

    // ISO Kalenderwoche berechnen
    const getISOWeek = (d: Date) => {
      const tmp = new Date(d)
      tmp.setHours(0, 0, 0, 0)
      tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7))
      const yearStart = new Date(tmp.getFullYear(), 0, 1)
      return { kw: Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: tmp.getFullYear() }
    }
    const { kw, year } = getISOWeek(monday)

    return {
      days: Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday)
        d.setDate(monday.getDate() + i)
        return { iso: toISODate(d), day: d.getDate(), label: d.toLocaleDateString("de-DE", { weekday: "short" }), inMonth: d.getMonth() === today.getMonth() }
      }),
      kw,
      year
    }
  }, [selectedISO])

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setAddDialogOpen(true) }
      if (e.key === "ArrowLeft") { e.preventDefault(); setCursorMonth(m => addMonths(m, -1)) }
      if (e.key === "ArrowRight") { e.preventDefault(); setCursorMonth(m => addMonths(m, 1)) }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); setDarkMode(v => !v) }
      if (e.key === "t" || e.key === "T") { e.preventDefault(); setSelectedISO(toISODate(new Date())); setCursorMonth(startOfMonth(new Date())) }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [userId])


  if (!authReady) {
    return (
      <div className="min-h-screen grid place-items-center p-4">
        <Card className="w-full max-w-md rounded-2xl">
          <CardHeader>
            <CardTitle>Task/Kalender</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Lade…</CardContent>
        </Card>
      </div>
    )
  }

  // Recovery screen takes precedence over everything
  if (recoveryMode) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-4" lang="de" translate="no">
        <Card className="w-full max-w-md rounded-2xl shadow-sm" translate="no">
          <CardHeader className="pb-3" translate="no">
            <CardTitle className="text-base" translate="no">
              Neues Passwort setzen
            </CardTitle>
          </CardHeader>

          <CardContent className="grid gap-3" translate="no">
            <div className="grid gap-2" translate="no">
              <Label translate="no">Neues Passwort</Label>
              <Input value={newPass1} onChange={(e) => setNewPass1(e.target.value)} type="password" />
            </div>

            <div className="grid gap-2" translate="no">
              <Label translate="no">Neues Passwort wiederholen</Label>
              <Input value={newPass2} onChange={(e) => setNewPass2(e.target.value)} type="password" />
            </div>

            {recoveryMsg ? (
              <div className="text-sm text-rose-600" translate="no">
                {recoveryMsg}
              </div>
            ) : null}

            <Button onClick={updatePassword}>Passwort speichern</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-4">
        <Card className="w-full max-w-md rounded-2xl shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{resetMode ? "Passwort zurücksetzen" : "Login"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@email.com" />
            </div>

            {resetMode ? null : (
              <div className="grid gap-2">
                <Label>Passwort</Label>
                <Input value={authPass} onChange={(e) => setAuthPass(e.target.value)} type="password" />
              </div>
            )}

            {authMsg ? <div className="text-sm text-rose-600">{authMsg}</div> : null}
            {resetMsg ? <div className="text-sm text-emerald-600">{resetMsg}</div> : null}

            {resetMode ? (
              <>
                <Button onClick={requestPasswordReset} disabled={authEmail.trim().length === 0}>
                  Reset-Mail senden
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setResetMode(false)
                    setResetMsg("")
                    setAuthMsg("")
                  }}
                >
                  Zurück zum Login
                </Button>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={signIn}>
                    Einloggen
                  </Button>
                  <Button className="flex-1" variant="outline" onClick={signUp}>
                    Registrieren
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setResetMode(true)
                    setResetMsg("")
                    setAuthMsg("")
                  }}
                >
                  Passwort vergessen?
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-safe">
      <div className="mx-auto max-w-[1800px] p-3 sm:p-4 md:p-6">
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="grid h-9 w-9 sm:h-10 sm:w-10 place-items-center rounded-xl sm:rounded-2xl border flex-shrink-0">
                <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-lg sm:text-xl font-semibold truncate">Study Calendar</div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Streak Badge */}
              {streak > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-xl px-3 py-1.5">
                  <Flame className="h-4 w-4 text-orange-500" />
                  <span className="text-sm font-semibold text-orange-600 dark:text-orange-400">{streak}</span>
                  <span className="text-xs text-orange-500/70 hidden md:inline">Tage</span>
                </div>
              )}

              {/* Dark Mode Toggle */}
              <Button variant="outline" size="icon" onClick={() => setDarkMode(v => !v)} className="h-9 w-9" title="Dark Mode (D)">
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              <Button variant="outline" size="sm" onClick={signOut} className="flex-shrink-0">
                Logout
              </Button>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCursorMonth((m) => addMonths(m, calView === "year" ? -12 : -1))} className="h-9 w-9 flex-shrink-0" title="Vorheriger Monat (←)">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 rounded-xl border px-3 py-2 text-center text-sm font-medium min-w-0">
              <span className="truncate block">
                {calView === "year" ? cursorMonth.getFullYear() : calView === "week" ? `KW ${weekCells.kw} · ${weekCells.year}` : monthLabel}
              </span>
            </div>
            <Button variant="outline" size="icon" onClick={() => { setSelectedISO(todayISO); setCursorMonth(startOfMonth(new Date())) }} className="h-9 px-3 text-xs" title="Heute (T)">
              Heute
            </Button>
            <Button variant="outline" size="icon" onClick={() => setCursorMonth((m) => addMonths(m, calView === "year" ? 12 : 1))} className="h-9 w-9 flex-shrink-0" title="Nächster Monat (→)">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Keyboard Shortcuts Hinweis – nur Desktop */}
          <div className="hidden lg:flex items-center gap-3 text-[10px] text-muted-foreground/60">
            <span><kbd className="px-1 py-0.5 rounded border text-[9px]">N</kbd> Neue Aufgabe</span>
            <span><kbd className="px-1 py-0.5 rounded border text-[9px]">T</kbd> Heute</span>
            <span><kbd className="px-1 py-0.5 rounded border text-[9px]">←</kbd><kbd className="px-1 py-0.5 rounded border text-[9px]">→</kbd> Monat</span>
            <span><kbd className="px-1 py-0.5 rounded border text-[9px]">D</kbd> Dark Mode</span>
          </div>
        </div>

        <Tabs defaultValue="kalender" className="mt-4 sm:mt-6">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="kalender" className="gap-1.5 sm:gap-2 text-xs sm:text-sm whitespace-nowrap">
              <CalendarDays className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Kalender
            </TabsTrigger>
            <TabsTrigger value="kategorien" className="gap-1.5 sm:gap-2 text-xs sm:text-sm whitespace-nowrap">
              <Tag className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Kategorien
            </TabsTrigger>
            <TabsTrigger value="fortschritt" className="gap-1.5 sm:gap-2 text-xs sm:text-sm whitespace-nowrap">
              <List className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Fortschritt
            </TabsTrigger>
          </TabsList>

          {/* Kalender */}
          <TabsContent value="kalender" className="mt-3 sm:mt-4">
            <div className="flex gap-3 sm:gap-4">
              {/* Spendenbox links - nur auf großen Desktop-Screens */}
              <Card className="hidden xl:flex flex-col items-center justify-start rounded-2xl shadow-sm p-6 w-[240px] flex-shrink-0 h-fit sticky top-6">
                <div className="text-center space-y-4">
                  <div className="text-base font-semibold">
                    Projekt unterstützen
                  </div>
                  
                  <img
                    src="/revolut-qr.jpg"
                    alt="Revolut QR Code"
                    className="w-32 h-32 object-contain mx-auto border rounded-lg"
                  />
                  
                  <a
                    href="https://revolut.me/eljoa"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-primary underline hover:text-primary/80 transition-colors break-all"
                  >
                    revolut.me/eljoa
                  </a>
                </div>
              </Card>

              {/* Kalender und To-dos Container - behält ursprüngliche max-width */}
              <div className="grid gap-3 sm:gap-4 lg:grid-cols-[1fr_380px] flex-1 max-w-6xl">
                <Card className="rounded-xl sm:rounded-2xl shadow-sm overflow-hidden">
                <CardHeader className="pb-2 sm:pb-3 border-b bg-muted/30">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm sm:text-base font-semibold">
                      {calView === "year"
                        ? cursorMonth.getFullYear().toString()
                        : calView === "week"
                        ? `KW ${weekCells.kw} · ${weekCells.year}`
                        : cursorMonth.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}
                    </CardTitle>
                    {/* Woche / Monat / Jahr Umschalter */}
                    <div className="flex items-center rounded-lg border overflow-hidden text-xs">
                      <button
                        onClick={() => setCalView("week")}
                        className={["px-3 py-1.5 transition-colors", calView === "week" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"].join(" ")}
                      >
                        Woche
                      </button>
                      <button
                        onClick={() => setCalView("month")}
                        className={["px-3 py-1.5 transition-colors border-l", calView === "month" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"].join(" ")}
                      >
                        Monat
                      </button>
                      <button
                        onClick={() => setCalView("year")}
                        className={["px-3 py-1.5 transition-colors border-l", calView === "year" ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"].join(" ")}
                      >
                        Jahr
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-3 sm:px-5 pt-4">

                  {calView === "month" ? (
                    <>
                      {/* Wochentage */}
                      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-muted-foreground mb-2 font-medium">
                        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
                          <div key={d} className="text-center py-1">{d}</div>
                        ))}
                      </div>

                      {/* Monatsraster */}
                      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                        {monthCells.map((cell) => {
                          const tasks = tasksByDate[cell.iso]
                          const { total, done, ratio } = dayCompletion(tasks)
                          const st = dayStatusClass(cell.iso, todayISO, tasks)
                          const isSelected = cell.iso === selectedISO
                          const isToday = cell.iso === todayISO
                          const isDragOver = dragOverISO === cell.iso
                          return (
                            <button
                              key={cell.iso}
                              type="button"
                              onClick={() => { setSelectedISO(cell.iso); if (!cell.inMonth) setCursorMonth(startOfMonth(parseISODate(cell.iso))) }}
                              onDragEnter={(e) => { e.preventDefault(); setDragOverISO(cell.iso) }}
                              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOverISO !== cell.iso) setDragOverISO(cell.iso) }}
                              onDragLeave={() => { if (dragOverISO === cell.iso) setDragOverISO("") }}
                              onDrop={(e) => { e.preventDefault(); const p = readDragPayload(e); dragRef.current = null; setDragOverISO(""); if (!p || p.kind !== "move") return; moveTask(p.fromISO, cell.iso, p.taskId) }}
                              className={["relative h-16 sm:h-[88px] rounded-xl border p-1.5 sm:p-2 text-left transition-all touch-manipulation", cell.inMonth ? "" : "opacity-40", st.border, st.bg, isSelected ? "ring-2 ring-primary shadow-sm" : "hover:shadow-sm hover:border-primary/30", isDragOver ? "ring-2 ring-primary scale-[1.02]" : ""].join(" ")}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <div className={["text-xs sm:text-sm font-semibold h-5 w-5 sm:h-6 sm:w-6 flex items-center justify-center rounded-full leading-none", isToday ? "bg-primary text-primary-foreground" : ""].join(" ")}>
                                  {cell.day}
                                </div>
                                {total > 0 && <span className="text-[9px] sm:text-[10px] text-muted-foreground font-medium leading-none mt-0.5">{done}/{total}</span>}
                              </div>
                              {total > 0 && (
                                <div className="absolute bottom-1.5 left-1.5 right-1.5">
                                  <div className="h-1 sm:h-1.5 rounded-full bg-black/10 overflow-hidden">
                                    <div className={["h-full rounded-full transition-all", ratio >= 1 ? "bg-emerald-500" : ratio >= 0.5 ? "bg-amber-400" : "bg-rose-400"].join(" ")} style={{ width: `${percent(ratio)}%` }} />
                                  </div>
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  ) : calView === "week" ? (
                    <>
                      {/* Wochenansicht */}
                      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                        {weekCells.days.map((cell) => {
                          const tasks = tasksByDate[cell.iso]
                          const { total, done, ratio } = dayCompletion(tasks)
                          const st = dayStatusClass(cell.iso, todayISO, tasks)
                          const isSelected = cell.iso === selectedISO
                          const isToday = cell.iso === todayISO
                          const isDragOver = dragOverISO === cell.iso
                          return (
                            <button
                              key={cell.iso}
                              type="button"
                              onClick={() => setSelectedISO(cell.iso)}
                              onDragEnter={(e) => { e.preventDefault(); setDragOverISO(cell.iso) }}
                              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOverISO !== cell.iso) setDragOverISO(cell.iso) }}
                              onDragLeave={() => { if (dragOverISO === cell.iso) setDragOverISO("") }}
                              onDrop={(e) => { e.preventDefault(); const p = readDragPayload(e); dragRef.current = null; setDragOverISO(""); if (!p || p.kind !== "move") return; moveTask(p.fromISO, cell.iso, p.taskId) }}
                              className={["relative rounded-xl border p-2 text-left transition-all touch-manipulation h-32 sm:h-40", st.border, st.bg, isSelected ? "ring-2 ring-primary shadow-sm" : "hover:shadow-sm hover:border-primary/30", isDragOver ? "ring-2 ring-primary" : ""].join(" ")}
                            >
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-[10px] text-muted-foreground font-medium">{cell.label}</span>
                                <div className={["text-base font-bold h-8 w-8 flex items-center justify-center rounded-full", isToday ? "bg-primary text-primary-foreground" : ""].join(" ")}>
                                  {cell.day}
                                </div>
                              </div>
                              {total > 0 && (
                                <div className="mt-2">
                                  <div className="text-[10px] text-center text-muted-foreground">{done}/{total}</div>
                                  <div className="mt-1 h-1.5 rounded-full bg-black/10 overflow-hidden">
                                    <div className={["h-full rounded-full transition-all", ratio >= 1 ? "bg-emerald-500" : ratio >= 0.5 ? "bg-amber-400" : "bg-rose-400"].join(" ")} style={{ width: `${percent(ratio)}%` }} />
                                  </div>
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Jahresansicht – 4×3 Monate */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {yearCells.map((m) => {
                          const isCurrentMonth = m.monthIndex === cursorMonth.getMonth() && m.year === cursorMonth.getFullYear()
                          const tone =
                            m.total === 0   ? "border-border bg-background" :
                            m.ratio >= 1    ? "border-emerald-400/70 bg-emerald-400/15" :
                            m.ratio >= 0.5  ? "border-amber-400/70 bg-amber-400/15" :
                                              "border-rose-400/70 bg-rose-400/15"
                          const barColor =
                            m.total === 0   ? "bg-muted" :
                            m.ratio >= 1    ? "bg-emerald-500" :
                            m.ratio >= 0.5  ? "bg-amber-400" :
                                              "bg-rose-400"

                          return (
                            <button
                              key={m.monthIndex}
                              type="button"
                              onClick={() => {
                                setCursorMonth(new Date(m.year, m.monthIndex, 1))
                                setCalView("month")
                              }}
                              className={[
                                "rounded-xl border p-3 text-left transition-all hover:shadow-md hover:scale-[1.02] active:scale-100",
                                tone,
                                isCurrentMonth ? "ring-2 ring-primary" : ""
                              ].join(" ")}
                            >
                              <div className="text-sm font-semibold">{m.label}</div>
                              {m.total > 0 ? (
                                <>
                                  <div className="text-xs text-muted-foreground mt-1">{m.done}/{m.total} erledigt</div>
                                  <div className="mt-2 h-1.5 rounded-full bg-black/10 overflow-hidden">
                                    <div className={["h-full rounded-full transition-all", barColor].join(" ")} style={{ width: `${percent(m.ratio)}%` }} />
                                  </div>
                                  <div className="mt-1 text-[10px] text-muted-foreground font-medium">{percent(m.ratio)}%</div>
                                </>
                              ) : (
                                <div className="text-[10px] text-muted-foreground mt-1">Keine Tasks</div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                      <div className="mt-3 text-xs text-center text-muted-foreground">Klicke auf einen Monat um zur Monatsansicht zu wechseln</div>
                    </>
                  )}

                  {/* Legende */}
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] sm:text-xs text-muted-foreground border-t pt-3">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> &lt; 50%</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> 50–99%</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> 100%</span>
                  </div>

                  {/* Mobile Spendenbox */}
                  <div className="mt-3 xl:hidden flex flex-col sm:flex-row items-center gap-3 rounded-xl border border-border p-3 bg-background">
                    <img src="/revolut-qr.jpg" alt="Revolut QR Code" className="w-20 h-20 sm:w-24 sm:h-24 object-contain flex-shrink-0" />
                    <div className="text-center sm:text-right w-full sm:w-auto">
                      <div className="text-sm font-medium">Projekt unterstützen</div>
                      <a href="https://revolut.me/eljoa" target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs text-primary underline break-all">revolut.me/eljoa</a>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* To-dos */}
              <Card className="rounded-xl sm:rounded-2xl shadow-sm overflow-hidden flex flex-col">
                <div className="border-b bg-muted/30 px-4 sm:px-5 py-3 flex items-center justify-between gap-2 flex-shrink-0">
                  <div>
                    <div className="text-sm font-semibold">To-dos</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{selectedDateLabel}</div>
                  </div>
                  <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-1.5 h-8 text-xs px-3 flex-shrink-0">
                        <Plus className="h-3.5 w-3.5" />
                        Hinzufügen
                      </Button>
                    </DialogTrigger>

                      <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] rounded-xl">
                        <DialogHeader>
                          <DialogTitle className="text-base sm:text-lg">Task hinzufügen</DialogTitle>
                        </DialogHeader>

                        <div className="grid gap-3">
                          <div className="grid gap-2">
                            <Label className="text-sm">Titel</Label>
                            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="z.B. Lernen" className="h-10" />
                          </div>

                          <div className="grid gap-2">
                            <Label className="text-sm">Kategorie (optional)</Label>
                            <Select value={newCategory} onValueChange={setNewCategory}>
                              <SelectTrigger className="h-10">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">– keine –</SelectItem>
                                {categories.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {c}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            {/* Neue Kategorie direkt im Dialog erstellen */}
                            <div className="flex gap-2 mt-1">
                              <Input
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault()
                                    const name = normalizeCategory(newCategoryName)
                                    if (name) {
                                      ensureCategory(name)
                                      setNewCategory(name)
                                      setNewCategoryName("")
                                    }
                                  }
                                }}
                                placeholder="Neue Kategorie erstellen…"
                                className="h-9 text-sm flex-1"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 px-3 text-sm flex-shrink-0"
                                disabled={!newCategoryName.trim()}
                                onClick={() => {
                                  const name = normalizeCategory(newCategoryName)
                                  if (name) {
                                    ensureCategory(name)
                                    setNewCategory(name)
                                    setNewCategoryName("")
                                  }
                                }}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Checkbox checked={newHighPriority} onCheckedChange={(v) => setNewHighPriority(Boolean(v))} className="h-4 w-4" />
                            <span className="text-sm">Hohe Priorität</span>
                          </div>
                        </div>

                        <DialogFooter className="sm:justify-end">
                          <Button onClick={addTask} disabled={newTitle.trim().length === 0} className="w-full sm:w-auto">
                            Speichern
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                </div>

                  {/* Task-Liste */}
                  <div className="flex-1 overflow-y-auto">
                    {selectedTasks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <Plus className="h-5 w-5 opacity-40" />
                        </div>
                        <p className="text-sm">Keine Aufgaben für diesen Tag.</p>
                      </div>
                    ) : (
                      <div className="divide-y">
                        {getSortedDayTasks(selectedISO).map((t) => {
                          const isOver = dragOverTaskId === t.id
                          const overClass =
                            isOver && dragRef.current?.kind === "reorder"
                              ? "ring-2 ring-primary/60 ring-inset"
                              : ""

                          return (
                            <div
                              key={t.id}
                              className={["flex items-center gap-2 sm:gap-3 px-4 py-3 hover:bg-muted/20 transition-colors touch-manipulation", overClass].join(" ")}
                              onDragOver={(e) => {
                                const p = readDragPayload(e)
                                if (!p || p.kind !== "reorder") return
                                if (p.fromISO !== selectedISO) return
                                if (p.taskId === t.id) return

                                e.preventDefault()
                                e.dataTransfer.dropEffect = "move"

                                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                                const mid = rect.top + rect.height / 2
                                const pos = e.clientY < mid ? "above" : "below"
                                setDragOverTaskId(t.id)
                                setDragPos(pos)
                              }}
                              onDragLeave={() => {
                                if (dragOverTaskId === t.id) setDragOverTaskId("")
                              }}
                              onDrop={(e) => {
                                const p = readDragPayload(e)
                                dragRef.current = null
                                setDragOverTaskId("")
                                if (!p || p.kind !== "reorder") return
                                if (p.fromISO !== selectedISO) return
                                e.preventDefault()
                                applyReorderWithinDay(p.taskId, t.id, dragPos)
                              }}
                              draggable
                              onDragStart={(e) => setDragPayload(e, { kind: "move", taskId: t.id, fromISO: selectedISO })}
                              onDragEnd={() => {
                                dragRef.current = null
                                setDragOverISO("")
                                setDragOverTaskId("")
                              }}
                            >
                              <Checkbox className="h-4 w-4 flex-shrink-0" checked={t.done} onCheckedChange={() => toggleTask(t.id)} />

                              <div className="min-w-0 flex-1">
                                <div className={[
                                  "text-sm break-words leading-snug",
                                  t.done ? "line-through text-muted-foreground" : "font-medium"
                                ].join(" ")}>
                                  {t.title}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {t.category && (
                                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                                      {t.category}
                                    </Badge>
                                  )}
                                  {(t.priority ?? 1) >= 2 && (
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black leading-none text-white">!</span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-40 hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="icon" onClick={() => openEditTask(t)} aria-label="Bearbeiten" className="h-7 w-7">
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => deleteTask(t.id)} aria-label="Löschen" className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50">
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                                <span
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted cursor-grab active:cursor-grabbing"
                                  draggable
                                  onDragStart={(e) => {
                                    e.stopPropagation()
                                    setDragPayload(e, { kind: "reorder", taskId: t.id, fromISO: selectedISO })
                                  }}
                                  onDragEnd={() => {
                                    dragRef.current = null
                                    setDragOverTaskId("")
                                  }}
                                >
                                  <GripHorizontal className="h-3 w-3" />
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                    <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] rounded-xl">
                      <DialogHeader>
                        <DialogTitle className="text-base sm:text-lg">Task bearbeiten</DialogTitle>
                      </DialogHeader>

                      <div className="grid gap-3">
                        <div className="grid gap-2">
                          <Label className="text-sm">Titel</Label>
                          <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Titel" className="h-10" />
                        </div>

                        <div className="grid gap-2">
                          <Label className="text-sm">Kategorie (optional)</Label>
                          <Select value={editCategory} onValueChange={setEditCategory}>
                            <SelectTrigger className="h-10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">– keine –</SelectItem>
                              {categories.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center gap-2">
                          <Checkbox checked={editHighPriority} onCheckedChange={(v) => setEditHighPriority(Boolean(v))} className="h-4 w-4" />
                          <span className="text-sm">Hohe Priorität</span>
                        </div>
                      </div>

                      <DialogFooter className="sm:justify-end">
                        <Button onClick={saveEditTask} disabled={editTitle.trim().length === 0} className="w-full sm:w-auto">
                          Speichern
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
              </Card>
              </div>
            </div>
          </TabsContent>

          {/* Kategorien – neu gestaltet */}
          <TabsContent value="kategorien" className="mt-3 sm:mt-4">
            <div className="max-w-2xl mx-auto grid gap-4">

              {/* Neue Kategorie */}
              <Card className="rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-muted/40 px-5 py-3 border-b">
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Neue Kategorie</h2>
                </div>
                <CardContent className="pt-4 pb-5 px-5">
                  <div className="flex gap-2">
                    <Input
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCategoryFromInput()}
                      placeholder="z.B. Sport, Mathe, Projekt…"
                      className="h-10 text-sm flex-1"
                    />
                    <Button onClick={addCategoryFromInput} className="h-10 px-5 text-sm gap-2 flex-shrink-0">
                      <Plus className="h-4 w-4" />
                      Hinzufügen
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Bestehende Kategorien */}
              <Card className="rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-muted/40 px-5 py-3 border-b flex items-center justify-between">
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Kategorien</h2>
                  <span className="text-xs text-muted-foreground bg-background border rounded-full px-2 py-0.5">
                    {categories.length} {categories.length === 1 ? "Eintrag" : "Einträge"}
                  </span>
                </div>
                <CardContent className="p-0">
                  {categories.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                      <Tag className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Noch keine Kategorien vorhanden.</p>
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {categories.map((c, idx) => (
                        <li key={c} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors group">
                          {/* Farbige Nummer */}
                          <span className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                            {idx + 1}
                          </span>

                          <span className="flex-1 text-sm font-medium truncate">{c}</span>

                          <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => { setRenameFrom(c); setRenameTo(c) }}
                              className="h-8 px-3 text-xs gap-1.5"
                            >
                              <Pencil className="h-3 w-3" />
                              Umbenennen
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteCategory(c)}
                              aria-label="Löschen"
                              className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="px-5 py-2.5 border-t bg-muted/20">
                    <p className="text-[11px] text-muted-foreground">Löschen setzt die Kategorie aller zugehörigen Tasks auf „Ohne Kategorie".</p>
                  </div>
                </CardContent>
              </Card>

              {/* Umbenennen – nur anzeigen wenn eine Kategorie ausgewählt */}
              {renameFrom && renameFrom !== "—" && (
                <Card className="rounded-2xl shadow-sm overflow-hidden border-primary/30">
                  <div className="bg-primary/5 px-5 py-3 border-b border-primary/20">
                    <h2 className="text-sm font-semibold tracking-wide uppercase text-primary/70">Umbenennen</h2>
                  </div>
                  <CardContent className="pt-4 pb-5 px-5 grid gap-3">
                    <div className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-2.5">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">Aktuell:</span>
                      <Badge variant="secondary" className="text-sm font-medium">{renameFrom}</Badge>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Neuer Name</Label>
                      <Input
                        value={renameTo}
                        onChange={(e) => setRenameTo(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && renameFrom && renameFrom !== "—") {
                            renameCategory(renameFrom, renameTo)
                            setRenameFrom("")
                            setRenameTo("")
                          }
                        }}
                        placeholder="Neuer Name…"
                        className="h-10 text-sm"
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        onClick={() => {
                          renameCategory(renameFrom, renameTo)
                          setRenameFrom("")
                          setRenameTo("")
                        }}
                        disabled={!renameTo.trim() || renameTo === renameFrom}
                        className="flex-1 h-9 text-sm"
                      >
                        Speichern
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => { setRenameFrom(""); setRenameTo("") }}
                        className="h-9 px-4 text-sm"
                      >
                        Abbrechen
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

            </div>
          </TabsContent>

          {/* Fortschritt – neu gestaltet */}
          <TabsContent value="fortschritt" className="mt-3 sm:mt-4">
            <div className="max-w-2xl mx-auto grid gap-4">

              {/* Streak + Gesamt-Stats nebeneinander */}
              <div className="grid grid-cols-2 gap-3">
                {/* Streak Card */}
                <Card className="rounded-2xl shadow-sm overflow-hidden">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <Flame className="h-5 w-5 text-orange-500" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold tabular-nums">{streak}</div>
                      <div className="text-xs text-muted-foreground">Tage Streak</div>
                    </div>
                  </CardContent>
                </Card>

                {/* Gesamt-Abschlussrate */}
                {categoryStats.rows.length > 0 && (() => {
                  const totalAll = categoryStats.rows.reduce((s, r) => s + r.total, 0)
                  const doneAll  = categoryStats.rows.reduce((s, r) => s + r.done, 0)
                  const ratioAll = totalAll === 0 ? 0 : doneAll / totalAll
                  return (
                    <Card className="rounded-2xl shadow-sm overflow-hidden">
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <BarChart2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="text-2xl font-bold tabular-nums">{percent(ratioAll)}%</div>
                          <div className="text-xs text-muted-foreground">{doneAll}/{totalAll} erledigt</div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })()}
              </div>

              {/* Heatmap – letzte 12 Wochen */}
              <Card className="rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-muted/40 px-5 py-3 border-b">
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Aktivität (letzte 12 Wochen)</h2>
                </div>
                <CardContent className="px-4 pt-4 pb-5">
                  {(() => {
                    // Baue 12 Wochen à 7 Tage auf (Mo–So), neueste rechts
                    const today = new Date()
                    const dow = (today.getDay() + 6) % 7
                    const endDate = new Date(today)
                    endDate.setDate(today.getDate() - dow + 6) // Sonntag dieser Woche

                    const weeks: Array<Array<{ iso: ISODate; ratio: number; total: number }>> = []
                    for (let w = 11; w >= 0; w--) {
                      const week: Array<{ iso: ISODate; ratio: number; total: number }> = []
                      for (let d = 0; d < 7; d++) {
                        const date = new Date(endDate)
                        date.setDate(endDate.getDate() - w * 7 - (6 - d))
                        const iso = toISODate(date)
                        const tasks = tasksByDate[iso]
                        const { total, ratio } = dayCompletion(tasks)
                        week.push({ iso, ratio, total })
                      }
                      weeks.push(week)
                    }

                    return (
                      <div className="overflow-x-auto">
                        <div className="flex gap-1 min-w-fit">
                          {weeks.map((week, wi) => (
                            <div key={wi} className="flex flex-col gap-1">
                              {week.map((cell) => {
                                const isSelected = cell.iso === selectedISO
                                const bg =
                                  cell.total === 0 ? "bg-muted/50" :
                                  cell.ratio >= 1   ? "bg-emerald-500" :
                                  cell.ratio >= 0.5 ? "bg-amber-400" :
                                                      "bg-rose-300"
                                return (
                                  <button
                                    key={cell.iso}
                                    onClick={() => { setSelectedISO(cell.iso); setCursorMonth(startOfMonth(parseISODate(cell.iso))) }}
                                    title={`${cell.iso}: ${cell.total > 0 ? `${Math.round(cell.ratio * 100)}%` : "Keine Tasks"}`}
                                    className={["h-5 w-5 rounded-sm transition-all hover:scale-110", bg, isSelected ? "ring-2 ring-primary ring-offset-1" : ""].join(" ")}
                                  />
                                )
                              })}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
                          <span>Weniger</span>
                          <span className="h-3 w-3 rounded-sm bg-muted/50" />
                          <span className="h-3 w-3 rounded-sm bg-rose-300" />
                          <span className="h-3 w-3 rounded-sm bg-amber-400" />
                          <span className="h-3 w-3 rounded-sm bg-emerald-500" />
                          <span>Mehr</span>
                        </div>
                      </div>
                    )
                  })()}
                </CardContent>
              </Card>

              {/* Gesamt-Übersicht oben */}
              {categoryStats.rows.length > 0 && (() => {
                const totalAll = categoryStats.rows.reduce((s, r) => s + r.total, 0)
                const doneAll  = categoryStats.rows.reduce((s, r) => s + r.done,  0)
                const ratioAll = totalAll === 0 ? 0 : doneAll / totalAll
                return (
                  <Card className="rounded-2xl shadow-sm overflow-hidden">
                    <div className="bg-muted/40 px-5 py-3 border-b flex items-center justify-between">
                      <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Gesamt</h2>
                      <span className="text-xs text-muted-foreground">{doneAll} von {totalAll} erledigt</span>
                    </div>
                    <CardContent className="px-5 pt-4 pb-5">
                      <div className="flex items-end justify-between mb-2">
                        <span className="text-3xl font-bold tabular-nums">{percent(ratioAll)}%</span>
                        <span className="text-sm text-muted-foreground mb-1">{categoryStats.rows.length} Kategorien</span>
                      </div>
                      <Progress value={percent(ratioAll)} className="h-3 rounded-full" />
                    </CardContent>
                  </Card>
                )
              })()}

              {/* Kategorien-Liste */}
              <Card className="rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-muted/40 px-5 py-3 border-b">
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Nach Kategorie</h2>
                </div>
                <CardContent className="p-0">
                  {categoryStats.rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                      <List className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Noch keine Tasks für Statistik.</p>
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {categoryStats.rows.map((r) => {
                        const tone =
                          r.ratio >= 1   ? "bg-emerald-500" :
                          r.ratio >= 0.5 ? "bg-amber-400"   :
                          r.total === 0  ? "bg-muted"       : "bg-rose-400"

                        return (
                          <li key={r.label} className="px-5 py-4 hover:bg-muted/20 transition-colors">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <span className="text-sm font-medium truncate">{r.label}</span>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <span className="text-xs text-muted-foreground tabular-nums">{r.done}/{r.total}</span>
                                <span className={[
                                  "text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full text-white min-w-[3rem] text-center",
                                  tone
                                ].join(" ")}>
                                  {percent(r.ratio)}%
                                </span>
                              </div>
                            </div>
                            {/* Progress mit farbiger Bar */}
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className={["h-full rounded-full transition-all duration-500", tone].join(" ")}
                                style={{ width: `${percent(r.ratio)}%` }}
                              />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>

            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
