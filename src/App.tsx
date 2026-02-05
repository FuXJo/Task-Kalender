import React, { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Plus, Trash2, Tag, CalendarDays, List, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type ISODate = string

type Task = {
  id: string
  title: string
  category: string // "" = ohne Kategorie
  done: boolean
  createdAt: number
}

type Store = {
  categories: string[]
  tasksByDate: Record<ISODate, Task[]>
}

const LS_KEY = "task-kalender:v3"

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

function dayCompletion(tasks: Task[] | undefined) {
  const total = (tasks ?? []).length
  const done = (tasks ?? []).reduce((a, t) => a + (t.done ? 1 : 0), 0)
  const ratio = total === 0 ? 0 : done / total
  return { total, done, ratio }
}

// NUR Vergangenheit färben. Heute + Zukunft immer weiß.
function dayStatusClass(
  iso: ISODate,
  todayISO: ISODate,
  tasks: Task[] | undefined
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

function safeGetLS(key: string) {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetLS(key: string, value: string) {
  try {
    if (typeof window === "undefined") return
    window.localStorage.setItem(key, value)
  } catch {}
}

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function compactTasksByDate(map: Record<ISODate, Task[]>) {
  const next: Record<ISODate, Task[]> = {}
  for (const [iso, tasks] of Object.entries(map)) {
    if ((tasks ?? []).length > 0) next[iso] = tasks
  }
  return next
}

function msUntilNextLocalMidnight() {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
  return next.getTime() - now.getTime()
}

function loadStore(): Store {
  try {
    const raw = safeGetLS(LS_KEY)
    if (!raw) return { categories: [], tasksByDate: {} }
    const parsed = JSON.parse(raw) as Store
    const cats = (parsed.categories ?? []).map(normalizeCategory).filter(Boolean)
    const categories = Array.from(new Set(cats))
    const tasksByDate = parsed.tasksByDate ?? {}
    return { categories, tasksByDate }
  } catch {
    return { categories: [], tasksByDate: {} }
  }
}

// Drag payload
const DND_MIME = "application/x-taskkalender"
type DragPayload = { taskId: string; fromISO: ISODate }

export default function App() {
  const [store, setStore] = useState<Store>(() => loadStore())

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

  // Edit Task Dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editTaskId, setEditTaskId] = useState<string>("")
  const [editTitle, setEditTitle] = useState("")
  const [editCategory, setEditCategory] = useState<string>("__none__")

  // Category management
  const [newCategoryName, setNewCategoryName] = useState("")
  const [renameFrom, setRenameFrom] = useState<string>("")
  const [renameTo, setRenameTo] = useState<string>("")

  // Drag helpers
  const [dragOverISO, setDragOverISO] = useState<ISODate | "">("")
  const dragRef = useRef<DragPayload | null>(null)

  // Debounced save
  useEffect(() => {
    const t = window.setTimeout(() => {
      safeSetLS(LS_KEY, JSON.stringify(store))
    }, 150)
    return () => window.clearTimeout(t)
  }, [store])

  function ensureCategory(nameRaw: string) {
    const name = normalizeCategory(nameRaw)
    if (!name) return
    setStore((prev) => {
      if (prev.categories.includes(name)) return prev
      return { ...prev, categories: [...prev.categories, name] }
    })
  }

  function addTask() {
    const title = newTitle.trim()
    if (!title) return

    const cat = newCategory === "__none__" ? "" : normalizeCategory(newCategory)
    if (cat) ensureCategory(cat)

    const task: Task = {
      id: uuid(),
      title,
      category: cat,
      done: false,
      createdAt: Date.now(),
    }

    setStore((prev) => {
      const tasks = prev.tasksByDate[selectedISO] ?? []
      return { ...prev, tasksByDate: { ...prev.tasksByDate, [selectedISO]: [...tasks, task] } }
    })

    setNewTitle("")
    setNewCategory("__none__")
    setAddDialogOpen(false)
  }

  function toggleTask(taskId: string) {
    setStore((prev) => {
      const tasks = prev.tasksByDate[selectedISO] ?? []
      const next = tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t))
      return { ...prev, tasksByDate: { ...prev.tasksByDate, [selectedISO]: next } }
    })
  }

  function deleteTask(taskId: string) {
    setStore((prev) => {
      const tasks = prev.tasksByDate[selectedISO] ?? []
      const next = tasks.filter((t) => t.id !== taskId)
      const map = { ...prev.tasksByDate, [selectedISO]: next }
      if (next.length === 0) delete map[selectedISO]
      return { ...prev, tasksByDate: map }
    })
  }

  function openEditTask(task: Task) {
    setEditTaskId(task.id)
    setEditTitle(task.title)
    setEditCategory(task.category ? task.category : "__none__")
    setEditDialogOpen(true)
  }

  function saveEditTask() {
    const title = editTitle.trim()
    if (!title) return

    const cat = editCategory === "__none__" ? "" : normalizeCategory(editCategory)
    if (cat) ensureCategory(cat)

    setStore((prev) => {
      const tasks = prev.tasksByDate[selectedISO] ?? []
      const next = tasks.map((t) => (t.id === editTaskId ? { ...t, title, category: cat } : t))
      return { ...prev, tasksByDate: { ...prev.tasksByDate, [selectedISO]: next } }
    })

    setEditDialogOpen(false)
    setEditTaskId("")
    setEditTitle("")
    setEditCategory("__none__")
  }

  function addCategoryFromInput() {
    const name = normalizeCategory(newCategoryName)
    if (!name) return
    ensureCategory(name)
    setNewCategoryName("")
  }

  function deleteCategory(category: string) {
    const cat = normalizeCategory(category)
    if (!cat) return

    setStore((prev) => {
      const remaining = prev.categories.filter((c) => c !== cat)

      const nextTasksByDate: Record<ISODate, Task[]> = {}
      for (const [iso, tasks] of Object.entries(prev.tasksByDate)) {
        nextTasksByDate[iso] = (tasks ?? []).map((t) => (t.category === cat ? { ...t, category: "" } : t))
      }

      return { ...prev, categories: remaining, tasksByDate: compactTasksByDate(nextTasksByDate) }
    })

    if (newCategory === cat) setNewCategory("__none__")
    if (editCategory === cat) setEditCategory("__none__")
  }

  function renameCategory(oldName: string, newNameRaw: string) {
    const from = normalizeCategory(oldName)
    const to = normalizeCategory(newNameRaw)
    if (!from || !to || from === to) return

    setStore((prev) => {
      const categories = prev.categories.map((c) => (c === from ? to : c))
      const unique = Array.from(new Set(categories.filter(Boolean)))

      const nextTasksByDate: Record<ISODate, Task[]> = {}
      for (const [iso, tasks] of Object.entries(prev.tasksByDate)) {
        nextTasksByDate[iso] = (tasks ?? []).map((t) => (t.category === from ? { ...t, category: to } : t))
      }

      return { ...prev, categories: unique, tasksByDate: compactTasksByDate(nextTasksByDate) }
    })

    if (newCategory === from) setNewCategory(to)
    if (editCategory === from) setEditCategory(to)
  }

  function moveTask(fromISO: ISODate, toISO: ISODate, taskId: string) {
    if (!fromISO || !toISO || fromISO === toISO) return

    setStore((prev) => {
      const fromTasks = prev.tasksByDate[fromISO] ?? []
      const toTasks = prev.tasksByDate[toISO] ?? []

      const idx = fromTasks.findIndex((t) => t.id === taskId)
      if (idx < 0) return prev

      const task = fromTasks[idx]
      const nextFrom = fromTasks.filter((t) => t.id !== taskId)
      const nextTo = [...toTasks, task]

      const nextMap = { ...prev.tasksByDate, [fromISO]: nextFrom, [toISO]: nextTo }
      if (nextFrom.length === 0) delete nextMap[fromISO]

      return { ...prev, tasksByDate: nextMap }
    })
  }

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
      if (!p?.taskId || !p?.fromISO) return null
      return p
    } catch {
      return null
    }
  }

  const monthLabel = cursorMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })

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

  const selectedTasks = store.tasksByDate[selectedISO] ?? []
  const selectedDateLabel = useMemo(() => {
    return parseISODate(selectedISO).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }, [selectedISO])

  const categoryStats = useMemo(() => {
    const acc: Record<string, { total: number; done: number }> = {}
    for (const c of store.categories) acc[c] = { total: 0, done: 0 }
    acc[""] = acc[""] ?? { total: 0, done: 0 }

    for (const tasks of Object.values(store.tasksByDate)) {
      for (const t of tasks ?? []) {
        const c = normalizeCategory(t.category)
        if (c !== "" && !acc[c]) acc[c] = { total: 0, done: 0 }
        acc[c].total += 1
        if (t.done) acc[c].done += 1
      }
    }

    const rows = Object.entries(acc)
      .map(([category, v]) => ({
        category,
        label: category === "" ? "Ohne Kategorie" : category,
        total: v.total,
        done: v.done,
        ratio: v.total === 0 ? 0 : v.done / v.total,
      }))
      .filter((r) => r.total > 0 || r.category !== "")
      .sort((a, b) => a.label.localeCompare(b.label))

    return { rows }
  }, [store])

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl border">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-semibold">Task/Kalender</div>
              <div className="text-sm text-muted-foreground">Monatsübersicht · Kategorien · Fortschritt</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCursorMonth((m) => addMonths(m, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[200px] rounded-xl border px-3 py-2 text-center text-sm font-medium">{monthLabel}</div>
            <Button variant="outline" size="icon" onClick={() => setCursorMonth((m) => addMonths(m, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Tabs defaultValue="kalender" className="mt-6">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="kalender" className="gap-2">
              <CalendarDays className="h-4 w-4" />
              Kalender
            </TabsTrigger>
            <TabsTrigger value="kategorien" className="gap-2">
              <Tag className="h-4 w-4" />
              Kategorien
            </TabsTrigger>
            <TabsTrigger value="fortschritt" className="gap-2">
              <List className="h-4 w-4" />
              Fortschritt
            </TabsTrigger>
          </TabsList>

          {/* Kalender */}
          <TabsContent value="kalender" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {cursorMonth.toLocaleDateString("de-DE", {
                      month: "long",
                      year: "numeric",
                    })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-7 gap-3 text-xs text-muted-foreground">
                    {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
                      <div key={d} className="px-1">
                        {d}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-7 gap-3">
                    {monthCells.map((cell) => {
                      const tasks = store.tasksByDate[cell.iso]
                      const { total, done, ratio } = dayCompletion(tasks)
                      const st = dayStatusClass(cell.iso, todayISO, tasks)
                      const isSelected = cell.iso === selectedISO
                      const isDragOver = dragOverISO === cell.iso

                      return (
                        <button
                          key={cell.iso}
                          type="button"
                          onClick={() => {
                            setSelectedISO(cell.iso)
                            if (!cell.inMonth) setCursorMonth(startOfMonth(parseISODate(cell.iso)))
                          }}
                          onDragEnter={(e) => {
                            e.preventDefault()
                            setDragOverISO(cell.iso)
                          }}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = "move"
                            if (dragOverISO !== cell.iso) setDragOverISO(cell.iso)
                          }}
                          onDragLeave={() => {
                            if (dragOverISO === cell.iso) setDragOverISO("")
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            const p = readDragPayload(e)
                            dragRef.current = null
                            setDragOverISO("")
                            if (!p) return
                            moveTask(p.fromISO, cell.iso, p.taskId)
                          }}
                          className={[
                            "relative h-24 rounded-2xl border p-2 text-left transition",
                            cell.inMonth ? "" : "opacity-50",
                            st.border,
                            st.bg,
                            isSelected ? "ring-2 ring-primary/40" : "hover:bg-muted/40",
                            isDragOver ? "ring-2 ring-primary" : "",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-sm font-semibold">{cell.day}</div>
                            {total > 0 && (
                              <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                                {done}/{total}
                              </Badge>
                            )}
                          </div>

                          {total > 0 && (
                            <div className="absolute bottom-2 left-2 right-2 grid gap-1">
                              <Progress value={percent(ratio)} />
                              <div className="text-[11px] text-muted-foreground">{percent(ratio)}%</div>
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm border border-rose-400/70 bg-rose-400/15" /> &lt; 50%
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm border border-amber-400/70 bg-amber-400/15" /> 50–99%
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm border border-emerald-400/70 bg-emerald-400/15" /> 100%
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Aufgabenliste rechts */}
              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Aufgaben am ausgewählten Tag</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{selectedDateLabel}</div>

                    <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                      <DialogTrigger asChild>
                        <Button className="gap-2">
                          <Plus className="h-4 w-4" />
                          Hinzufügen
                        </Button>
                      </DialogTrigger>

                      <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Task hinzufügen</DialogTitle>
                        </DialogHeader>

                        <div className="grid gap-3">
                          <div className="grid gap-2">
                            <Label>Titel</Label>
                            <Input
                              value={newTitle}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)}
                              placeholder="z.B. Lernen"
                            />
                          </div>

                          <div className="grid gap-2">
                            <Label>Kategorie (optional)</Label>
                            <Select value={newCategory} onValueChange={setNewCategory}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Ohne Kategorie</SelectItem>
                                {store.categories.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {c}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <DialogFooter>
                          <Button onClick={addTask} disabled={newTitle.trim().length === 0}>
                            Speichern
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="rounded-2xl border">
                    {selectedTasks.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">Keine Aufgaben für diesen Tag.</div>
                    ) : (
                      <div className="divide-y">
                        {selectedTasks
                          .slice()
                          .sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt)
                          .map((t) => (
                            <div
                              key={t.id}
                              className="flex items-center gap-3 p-3"
                              draggable
                              onDragStart={(e) => setDragPayload(e, { taskId: t.id, fromISO: selectedISO })}
                              onDragEnd={() => {
                                dragRef.current = null
                                setDragOverISO("")
                              }}
                              title="Drag & Drop: Aufgabe auf einen Tag im Kalender ziehen"
                            >
                              <Checkbox checked={t.done} onCheckedChange={() => toggleTask(t.id)} />

                              <div className="min-w-0 flex-1">
                                <div className={"truncate text-sm " + (t.done ? "line-through text-muted-foreground" : "")}>
                                  {t.title}
                                </div>
                                <div className="mt-1">
                                  <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                                    {t.category ? t.category : "Ohne Kategorie"}
                                  </Badge>
                                </div>
                              </div>

                              <Button variant="ghost" size="icon" onClick={() => openEditTask(t)} aria-label="Bearbeiten">
                                <Pencil className="h-4 w-4" />
                              </Button>

                              <Button variant="ghost" size="icon" onClick={() => deleteTask(t.id)} aria-label="Löschen">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Task bearbeiten</DialogTitle>
                      </DialogHeader>

                      <div className="grid gap-3">
                        <div className="grid gap-2">
                          <Label>Titel</Label>
                          <Input
                            value={editTitle}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditTitle(e.target.value)}
                            placeholder="Titel"
                          />
                        </div>

                        <div className="grid gap-2">
                          <Label>Kategorie (optional)</Label>
                          <Select value={editCategory} onValueChange={setEditCategory}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Ohne Kategorie</SelectItem>
                              {store.categories.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <DialogFooter>
                        <Button onClick={saveEditTask} disabled={editTitle.trim().length === 0}>
                          Speichern
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Kategorien */}
          <TabsContent value="kategorien" className="mt-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Kategorien verwalten</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2 rounded-2xl border p-3">
                  <Label>Neue Kategorie</Label>
                  <div className="flex gap-2">
                    <Input
                      value={newCategoryName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewCategoryName(e.target.value)}
                      placeholder="z.B. Sport"
                    />
                    <Button variant="outline" onClick={addCategoryFromInput}>
                      Hinzufügen
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 rounded-2xl border p-3">
                  <div className="text-sm font-medium">Vorhanden (löschen / umbenennen)</div>
                  <div className="grid gap-2">
                    {store.categories.length === 0 ? (
                      <div className="text-sm text-muted-foreground">Noch keine Kategorien.</div>
                    ) : (
                      store.categories
                        .slice()
                        .sort((a, b) => a.localeCompare(b))
                        .map((c) => (
                          <div key={c} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2">
                            <Badge variant="secondary">{c}</Badge>

                            <div className="ml-auto flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setRenameFrom(c)
                                  setRenameTo(c)
                                }}
                              >
                                Umbenennen
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteCategory(c)}
                                aria-label="Kategorie löschen"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                    )}
                  </div>

                  <div className="mt-2 text-xs text-muted-foreground">
                    Löschen entfernt nur die Kategorie — Tasks bleiben bestehen und werden zu „Ohne Kategorie“.
                  </div>
                </div>

                <Separator />

                <div className="grid gap-2 rounded-2xl border p-3">
                  <div className="text-sm font-medium">Kategorie umbenennen</div>
                  <div className="grid gap-2 md:grid-cols-3 md:items-end">
                    <div className="grid gap-1">
                      <Label>Von</Label>
                      <Select value={renameFrom || "—"} onValueChange={(v: string) => setRenameFrom(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="—">—</SelectItem>
                          {store.categories.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-1">
                      <Label>Nach</Label>
                      <Input
                        value={renameTo}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRenameTo(e.target.value)}
                        placeholder="Neuer Name"
                      />
                    </div>

                    <Button
                      type="button"
                      onClick={() => {
                        if (!renameFrom || renameFrom === "—") return
                        renameCategory(renameFrom, renameTo)
                        setRenameFrom("")
                        setRenameTo("")
                      }}
                      disabled={!renameFrom || renameFrom === "—"}
                    >
                      Speichern
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Fortschritt */}
          <TabsContent value="fortschritt" className="mt-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Fortschritt nach Kategorie</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {categoryStats.rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Noch keine Tasks für Statistik.</div>
                ) : (
                  categoryStats.rows.map((r) => (
                    <div key={r.label} className="rounded-2xl border p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{r.label}</span>
                        <span className="text-muted-foreground">
                          {r.done}/{r.total}
                        </span>
                      </div>
                      <Progress className="mt-2" value={percent(r.ratio)} />
                      <div className="mt-1 text-xs text-muted-foreground">{percent(r.ratio)}%</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
