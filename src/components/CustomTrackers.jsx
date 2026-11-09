import { useState, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { formatINR } from '../utils/format'
import { PencilIcon, TrashIcon, ChevronDownIcon, GripIcon, iconButton } from './icons'

// Fixed column widths per column type, so every tracker table lines up.
// Text columns get no width and share the remaining space.
const COLUMN_WIDTH = { date: 136, amount: 152, number: 120 }
const HANDLE_COL_WIDTH = 40
const NOTES_COL_WIDTH = 260
const ACTIONS_COL_WIDTH = 88

const signedINR = (num) => `${num > 0 ? '+' : num < 0 ? '−' : ''}${formatINR(Math.abs(num))}`
const isNumericType = (type) => type === 'amount' || type === 'number'
const amountTone = (num) => (num > 0 ? 'text-emerald-600' : num < 0 ? 'text-rose-600' : 'text-slate-700')

// Header control: one height, radius and type size for every button in the tracker header.
const headerButton = 'h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold transition-colors'
import {
  addCustomTracker,
  updateCustomTracker,
  deleteCustomTracker,
  reorderCustomTrackers,
  addTrackerEntry,
  updateTrackerEntry,
  updateTrackerEntryNotes,
  deleteTrackerEntry,
  reorderTrackerEntries,
  refreshFinanceData,
} from '../data/financeStorage'

// ── Main Custom Trackers Section ─────────────────────────────────────────────

export default function CustomTrackers({ session, trackers, onTrackersChange, darkMode }) {
  const [activeTrackerId, setActiveTrackerId] = useState(null)
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false)
  const [managingColumnsTracker, setManagingColumnsTracker] = useState(null)
  const [editingEntryTracker, setEditingEntryTracker] = useState(null) // { tracker, entry?: null }
  const [renamingTracker, setRenamingTracker] = useState(null)
  const [saveStatus, setSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const sortedTrackers = useMemo(() => {
    return [...(trackers || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }, [trackers])

  const executePersist = async (asyncFn) => {
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const res = await asyncFn()
      setSaveStatus('saved')
      setTimeout(() => {
        setSaveStatus(prev => (prev === 'saved' ? 'idle' : prev))
      }, 2500)
      return res
    } catch (err) {
      console.error('Custom Tracker persistence error:', err)
      setSaveStatus('error')
      setSaveError(err.message || 'Failed to save changes')
      // Nothing was saved (writes are all-or-nothing). Put the screen back to
      // the saved data so it never shows a change that doesn't exist.
      try {
        const fresh = await refreshFinanceData(session)
        onTrackersChange(fresh.custom_trackers || [])
      } catch {
        // Offline: keep the current view; the error banner explains it.
      }
      alert('Could not save this change: ' + (err.message || 'Network error') + '. Nothing was changed; the tracker shows your last saved data.')
    }
  }

  // Drag categories
  const handleDragStart = (event) => {
    setActiveTrackerId(event.active.id)
  }

  const handleDragEnd = async (event) => {
    const { active, over } = event
    setActiveTrackerId(null)
    if (!over || active.id === over.id) return

    const ids = sortedTrackers.map(t => t.id)
    const oldIndex = ids.indexOf(active.id)
    const newIndex = ids.indexOf(over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(sortedTrackers, oldIndex, newIndex).map((t, i) => ({
      ...t,
      sort_order: i,
    }))
    onTrackersChange(reordered)
    await executePersist(() => reorderCustomTrackers(session, reordered.map(t => t.id)))
  }

  // Create new category
  const handleCreateCategory = async (name, initialColumns) => {
    setShowAddCategoryModal(false)
    await executePersist(async () => {
      const newTracker = await addCustomTracker(session, {
        name,
        columns: initialColumns,
        show_total: true,
        entries: [],
      })
      if (newTracker) {
        onTrackersChange([...(trackers || []), newTracker])
      }
    })
  }

  // Delete category
  const handleDeleteCategory = async (tracker) => {
    const entryCount = (tracker.entries || []).length
    const msg = entryCount > 0
      ? `Delete category "${tracker.name}"? This will permanently delete ${entryCount} recorded ${entryCount === 1 ? 'entry' : 'entries'}.`
      : `Delete category "${tracker.name}"?`
    if (!window.confirm(msg)) return

    onTrackersChange((trackers || []).filter(t => t.id !== tracker.id))
    await executePersist(() => deleteCustomTracker(session, tracker.id))
  }

  // Rename category
  const handleSaveCategoryName = async (trackerId, newName) => {
    if (!newName.trim()) return
    onTrackersChange((trackers || []).map(t => t.id === trackerId ? { ...t, name: newName.trim() } : t))
    setRenamingTracker(null)
    await executePersist(() => updateCustomTracker(session, trackerId, { name: newName.trim() }))
  }

  // Toggle Collapse
  const handleToggleCollapse = async (tracker) => {
    const next = !tracker.is_collapsed
    onTrackersChange((trackers || []).map(t => t.id === tracker.id ? { ...t, is_collapsed: next } : t))
    await executePersist(() => updateCustomTracker(session, tracker.id, { is_collapsed: next }))
  }

  // Toggle Total
  const handleToggleTotal = async (tracker) => {
    const next = !tracker.show_total
    onTrackersChange((trackers || []).map(t => t.id === tracker.id ? { ...t, show_total: next } : t))
    await executePersist(() => updateCustomTracker(session, tracker.id, { show_total: next }))
  }

  // Update columns
  const handleUpdateColumns = async (trackerId, newColumns) => {
    onTrackersChange((trackers || []).map(t => t.id === trackerId ? { ...t, columns: newColumns } : t))
    setManagingColumnsTracker(null)
    await executePersist(() => updateCustomTracker(session, trackerId, { columns: newColumns }))
  }

  // Save entry (create or edit)
  const handleSaveEntry = async (trackerId, entryData, existingEntryId) => {
    setEditingEntryTracker(null)
    if (existingEntryId) {
      // Edit existing
      onTrackersChange((trackers || []).map(t => {
        if (t.id !== trackerId) return t
        return {
          ...t,
          entries: (t.entries || []).map(e => e.id === existingEntryId ? { ...e, ...entryData } : e),
        }
      }))
      await executePersist(() => updateTrackerEntry(session, trackerId, existingEntryId, entryData))
    } else {
      // Add new
      await executePersist(async () => {
        const created = await addTrackerEntry(session, trackerId, entryData)
        if (created) {
          onTrackersChange(prev => {
            const list = Array.isArray(prev) ? prev : (trackers || [])
            return list.map(t => {
              if (t.id !== trackerId) return t
              const currentEntries = t.entries || []
              if (currentEntries.some(e => e.id === created.id)) {
                return t
              }
              return {
                ...t,
                entries: [...currentEntries, created],
              }
            })
          })
        }
      })
    }
  }

  // Delete entry
  const handleDeleteEntry = async (trackerId, entryId) => {
    if (!window.confirm('Delete this entry?')) return
    onTrackersChange((trackers || []).map(t => {
      if (t.id !== trackerId) return t
      return {
        ...t,
        entries: (t.entries || []).filter(e => e.id !== entryId),
      }
    }))
    await executePersist(() => deleteTrackerEntry(session, trackerId, entryId))
  }

  // Add a note to an entry
  const handleAddNote = async (trackerId, entry, newNoteText) => {
    if (!newNoteText.trim()) return
    const updatedNotes = [...(entry.notes || []), newNoteText.trim()]
    onTrackersChange((trackers || []).map(t => {
      if (t.id !== trackerId) return t
      return {
        ...t,
        entries: (t.entries || []).map(e => e.id === entry.id ? { ...e, notes: updatedNotes } : e),
      }
    }))
    await executePersist(() =>
      updateTrackerEntryNotes(session, trackerId, entry.id, (saved) => [...saved, newNoteText.trim()])
    )
  }

  // Remove a note from an entry
  const handleRemoveNote = async (trackerId, entry, noteIndex) => {
    const noteText = (entry.notes || [])[noteIndex]
    const updatedNotes = (entry.notes || []).filter((_, i) => i !== noteIndex)
    onTrackersChange((trackers || []).map(t => {
      if (t.id !== trackerId) return t
      return {
        ...t,
        entries: (t.entries || []).map(e => e.id === entry.id ? { ...e, notes: updatedNotes } : e),
      }
    }))
    // Remove this note by its text from the latest saved list (an index from a
    // stale screen could point at a different note).
    await executePersist(() =>
      updateTrackerEntryNotes(session, trackerId, entry.id, (saved) => {
        const at = saved.indexOf(noteText)
        return at < 0 ? saved : saved.filter((_, i) => i !== at)
      })
    )
  }

  // Drag reorder entries
  const handleReorderEntries = async (trackerId, orderedEntryIds) => {
    const orderMap = Object.fromEntries(orderedEntryIds.map((id, i) => [id, i]))
    onTrackersChange(prev => {
      const list = Array.isArray(prev) ? prev : (trackers || [])
      return list.map(t => {
        if (t.id !== trackerId) return t
        const updatedEntries = (t.entries || [])
          .map(e => ({
            ...e,
            sort_order: orderMap[e.id] != null ? orderMap[e.id] : (e.sort_order ?? 0),
          }))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        return { ...t, entries: updatedEntries }
      })
    })
    await executePersist(() => reorderTrackerEntries(session, trackerId, orderedEntryIds))
  }

  const activeTracker = activeTrackerId ? sortedTrackers.find(t => t.id === activeTrackerId) : null

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-widest">Custom Trackers</h2>
            {saveStatus === 'saving' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                ✓ Saved
              </span>
            )}
            {saveStatus === 'error' && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200"
                title={saveError || 'Save failed'}
              >
                ⚠ Save Error
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Flexible ledgers with custom columns, positive/negative amounts, and notes</p>
        </div>
        <button
          onClick={() => setShowAddCategoryModal(true)}
          className="text-sm font-bold text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1.5"
        >
          <span>+ Add Category</span>
        </button>
      </div>

      {sortedTrackers.length === 0 ? (
        <div className="py-12 px-6 text-center border border-dashed border-gray-200 rounded-2xl bg-white/50">
          <p className="text-sm font-medium text-slate-600">No custom trackers yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Create independent categories to track money taken/given, credit card rewards, loan reconciliations, or any custom ledger.
          </p>
          <button
            onClick={() => setShowAddCategoryModal(true)}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all uppercase tracking-wider"
          >
            + Create First Category
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortedTrackers.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-6">
              {sortedTrackers.map(tracker => (
                <SortableCategoryCard
                  key={tracker.id}
                  tracker={tracker}
                  onToggleCollapse={() => handleToggleCollapse(tracker)}
                  onToggleTotal={() => handleToggleTotal(tracker)}
                  onOpenColumns={() => setManagingColumnsTracker(tracker)}
                  onOpenAddEntry={() => setEditingEntryTracker({ tracker, entry: null })}
                  onEditEntry={(entry) => setEditingEntryTracker({ tracker, entry })}
                  onDeleteEntry={(entryId) => handleDeleteEntry(tracker.id, entryId)}
                  onAddNote={(entry, note) => handleAddNote(tracker.id, entry, note)}
                  onRemoveNote={(entry, idx) => handleRemoveNote(tracker.id, entry, idx)}
                  onDeleteCategory={() => handleDeleteCategory(tracker)}
                  onStartRename={() => setRenamingTracker(tracker)}
                  onReorderEntries={(orderedIds) => handleReorderEntries(tracker.id, orderedIds)}
                />
              ))}
            </div>
          </SortableContext>

          <DragOverlay>
            {activeTracker ? (
              <div className="opacity-90 shadow-2xl rounded-2xl ring-2 ring-indigo-400 bg-white">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{activeTracker.name}</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Add Category Modal */}
      {showAddCategoryModal && (
        <AddCategoryModal
          onClose={() => setShowAddCategoryModal(false)}
          onCreate={handleCreateCategory}
        />
      )}

      {/* Rename Category Modal */}
      {renamingTracker && (
        <RenameModal
          tracker={renamingTracker}
          onClose={() => setRenamingTracker(null)}
          onSave={(newName) => handleSaveCategoryName(renamingTracker.id, newName)}
        />
      )}

      {/* Manage Columns Modal */}
      {managingColumnsTracker && (
        <ManageColumnsModal
          tracker={managingColumnsTracker}
          onClose={() => setManagingColumnsTracker(null)}
          onSaveColumns={(cols) => handleUpdateColumns(managingColumnsTracker.id, cols)}
        />
      )}

      {/* Add / Edit Entry Modal */}
      {editingEntryTracker && (
        <EntryModal
          tracker={editingEntryTracker.tracker}
          entry={editingEntryTracker.entry}
          onClose={() => setEditingEntryTracker(null)}
          onSave={(data) => handleSaveEntry(editingEntryTracker.tracker.id, data, editingEntryTracker.entry?.id)}
        />
      )}
    </section>
  )
}

// ── Sortable Category Card ───────────────────────────────────────────────────

function SortableCategoryCard({ tracker, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tracker.id,
    animateLayoutChanges: ({ isSorting, wasDragging }) => isSorting || wasDragging,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    position: 'relative',
  }

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? 'opacity-40' : ''}>
      <CategoryCard tracker={tracker} dragHandle={{ attributes, listeners }} {...props} />
    </div>
  )
}

// ── Category Card View ───────────────────────────────────────────────────────

function CategoryCard({
  tracker,
  dragHandle,
  onToggleCollapse,
  onToggleTotal,
  onOpenColumns,
  onOpenAddEntry,
  onEditEntry,
  onDeleteEntry,
  onAddNote,
  onRemoveNote,
  onDeleteCategory,
  onStartRename,
  onReorderEntries,
}) {
  const [activeEntryId, setActiveEntryId] = useState(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const entries = useMemo(() => {
    const seen = new Set()
    const list = (tracker.entries || []).map(entry => {
      if (!entry.id || seen.has(entry.id)) {
        return { ...entry, id: crypto.randomUUID() }
      }
      seen.add(entry.id)
      return entry
    })
    return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }, [tracker.entries])

  const columns = tracker.columns || []

  // Compute total for all amount columns
  const totalAmount = useMemo(() => {
    let sum = 0
    const amountColIds = columns.filter(c => c.type === 'amount').map(c => c.id)
    if (!amountColIds.length) return 0

    for (const entry of entries) {
      for (const colId of amountColIds) {
        const val = parseFloat(entry.values?.[colId]) || 0
        sum += val
      }
    }
    return Math.round(sum * 100) / 100
  }, [entries, columns])

  const firstAmountIdx = columns.findIndex(c => c.type === 'amount')
  const showTotalRow = tracker.show_total && entries.length > 0 && firstAmountIdx >= 0
  const tableMinWidth =
    HANDLE_COL_WIDTH + NOTES_COL_WIDTH + ACTIONS_COL_WIDTH +
    columns.reduce((sum, c) => sum + (COLUMN_WIDTH[c.type] || 180), 0)

  const handleEntryDragEnd = (event) => {
    const { active, over } = event
    setActiveEntryId(null)
    if (!over || active.id === over.id) return

    const ids = entries.map(e => e.id)
    const oldIndex = ids.indexOf(active.id)
    const newIndex = ids.indexOf(over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(entries, oldIndex, newIndex).map(e => e.id)
    onReorderEntries(reordered)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm transition-all hover:border-gray-300">
      {/* Category Header */}
      <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/40">
        <div className="flex items-center gap-2 min-w-0">
          {dragHandle && (
            <button
              type="button"
              aria-label="Drag to reorder category"
              className={`${iconButton} cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 hover:bg-slate-100`}
              {...dragHandle.attributes}
              {...dragHandle.listeners}
              onPointerDown={(e) => {
                e.stopPropagation()
                dragHandle.listeners?.onPointerDown?.(e)
              }}
            >
              <GripIcon />
            </button>
          )}

          <button
            onClick={onToggleCollapse}
            aria-expanded={!tracker.is_collapsed}
            className="h-8 flex items-center gap-1.5 min-w-0 text-left font-semibold text-gray-900 text-[15px] hover:text-indigo-600 transition-colors group"
          >
            <span className="truncate">{tracker.name}</span>
            <ChevronDownIcon
              className={`w-4 h-4 shrink-0 text-slate-400 group-hover:text-indigo-500 transition-transform ${tracker.is_collapsed ? '-rotate-90' : ''}`}
            />
          </button>
          <span className="shrink-0 text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpenAddEntry}
            className={`${headerButton} bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm`}
          >
            + Entry
          </button>

          <button
            onClick={onOpenColumns}
            className={`${headerButton} border border-slate-200 text-slate-600 hover:text-gray-900 hover:bg-slate-100`}
            title="Configure columns for this category"
          >
            Columns
            <span className="text-slate-400 tabular-nums">{columns.length}</span>
          </button>

          <button
            onClick={onToggleTotal}
            role="switch"
            aria-checked={!!tracker.show_total}
            className={`${headerButton} border border-slate-200 text-slate-600 hover:text-gray-900 hover:bg-slate-100`}
            title="Show or hide the category total"
          >
            Total
            <span
              className={`relative inline-block w-7 h-4 rounded-full transition-colors ${tracker.show_total ? 'bg-indigo-600' : 'bg-slate-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full shadow-sm transition-transform ${tracker.show_total ? 'translate-x-3' : ''}`}
                style={{ backgroundColor: '#fff' }}
              />
            </span>
          </button>

          <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden />

          <button
            onClick={onStartRename}
            className={`${iconButton} hover:text-gray-900 hover:bg-slate-100`}
            title="Rename category"
          >
            <PencilIcon />
          </button>

          <button
            onClick={onDeleteCategory}
            className={`${iconButton} hover:text-rose-600 hover:bg-rose-50`}
            title="Delete category"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Category Body */}
      {!tracker.is_collapsed && (
        <div className="p-4 sm:p-5">
          {entries.length === 0 ? (
            <div className="py-8 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/30">
              <p className="text-xs font-medium text-slate-500">No records in this category</p>
              <button
                onClick={onOpenAddEntry}
                className="mt-2 text-xs font-bold text-indigo-600 hover:text-indigo-700"
              >
                + Add First Entry
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragStart={(e) => setActiveEntryId(e.active.id)}
                onDragEnd={handleEntryDragEnd}
              >
                <table className="w-full table-fixed text-left border-collapse" style={{ minWidth: tableMinWidth }}>
                  <colgroup>
                    <col style={{ width: HANDLE_COL_WIDTH }} />
                    {columns.map(col => (
                      <col key={col.id} style={COLUMN_WIDTH[col.type] ? { width: COLUMN_WIDTH[col.type] } : undefined} />
                    ))}
                    <col style={{ width: NOTES_COL_WIDTH }} />
                    <col style={{ width: ACTIONS_COL_WIDTH }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="py-2.5 px-2"><span className="sr-only">Reorder</span></th>
                      {columns.map(col => (
                        <th
                          key={col.id}
                          className={`py-2.5 px-3 font-semibold truncate ${isNumericType(col.type) ? 'text-right pr-6' : ''}`}
                        >
                          {col.name}
                        </th>
                      ))}
                      <th className="py-2.5 px-3 font-semibold">Notes</th>
                      <th className="py-2.5 px-3 font-semibold text-right"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <SortableContext items={entries.map(e => e.id)} strategy={verticalListSortingStrategy}>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {entries.map(entry => (
                        <SortableEntryRow
                          key={entry.id}
                          entry={entry}
                          columns={columns}
                          onEdit={() => onEditEntry(entry)}
                          onDelete={() => onDeleteEntry(entry.id)}
                          onAddNote={(note) => onAddNote(entry, note)}
                          onRemoveNote={(idx) => onRemoveNote(entry, idx)}
                        />
                      ))}
                    </tbody>
                  </SortableContext>

                  {/* Category total, sitting directly under the (first) Amount column */}
                  {showTotalRow && (
                    <tfoot>
                      <tr className="border-t border-slate-200">
                        <td colSpan={firstAmountIdx + 1} className="pt-4 pb-1 pr-3" style={{ paddingLeft: HANDLE_COL_WIDTH + 12 }}>
                          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                            Total
                          </span>
                        </td>
                        <td className={`pt-4 pb-1 px-3 pr-6 text-right text-base font-bold tabular-nums whitespace-nowrap ${amountTone(totalAmount)}`}>
                          {signedINR(totalAmount)}
                        </td>
                        <td colSpan={columns.length - firstAmountIdx + 1} className="pt-4 pb-1 px-3">
                          {totalAmount !== 0 && (
                            <span
                              className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${totalAmount > 0
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}
                            >
                              {totalAmount > 0 ? 'Surplus · receivable' : 'Deficit · payable'}
                            </span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </DndContext>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sortable Entry Row ───────────────────────────────────────────────────────

function SortableEntryRow({ entry, columns, onEdit, onDelete, onAddNote, onRemoveNote }) {
  const [showAddNoteInput, setShowAddNoteInput] = useState(false)
  const [newNote, setNewNote] = useState('')

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
    animateLayoutChanges: ({ isSorting, wasDragging }) => isSorting || wasDragging,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.3 : 1,
  }

  const handleSaveNote = () => {
    if (newNote.trim()) {
      onAddNote(newNote.trim())
      setNewNote('')
      setShowAddNoteInput(false)
    }
  }

  return (
    <tr ref={setNodeRef} style={style} className="hover:bg-slate-50/70 transition-colors group/row align-middle">
      {/* Drag handle */}
      <td className="py-2 px-1">
        <button
          type="button"
          aria-label="Drag entry"
          className={`${iconButton} cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500`}
          {...attributes}
          {...listeners}
          onPointerDown={(e) => {
            e.stopPropagation()
            listeners?.onPointerDown?.(e)
          }}
        >
          <GripIcon />
        </button>
      </td>

      {/* Dynamic Columns */}
      {columns.map(col => {
        const val = entry.values?.[col.id]
        return (
          <td
            key={col.id}
            className={`py-3 px-3 ${isNumericType(col.type) ? 'text-right pr-6 whitespace-nowrap' : 'truncate'}`}
            title={col.type === 'text' && val ? String(val) : undefined}
          >
            <CellDisplay type={col.type} value={val} />
          </td>
        )
      })}

      {/* Attached Notes */}
      <td className="py-2 px-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(entry.notes || []).map((note, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 max-w-full text-xs font-medium bg-slate-100 text-slate-700 pl-2.5 pr-1 py-0.5 rounded-full border border-slate-200"
              title={note}
            >
              <span className="truncate">{note}</span>
              <button
                onClick={() => onRemoveNote(idx)}
                className="shrink-0 w-4 h-4 inline-flex items-center justify-center rounded-full text-[10px] text-slate-400 hover:text-rose-600 transition-colors"
                title="Remove note"
              >
                ✕
              </button>
            </span>
          ))}

          {showAddNoteInput ? (
            <div className="inline-flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveNote()
                  if (e.key === 'Escape') setShowAddNoteInput(false)
                }}
                placeholder="Note..."
                className="text-xs px-2 py-0.5 border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white w-28"
              />
              <button
                onClick={handleSaveNote}
                className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest"
              >
                ✓
              </button>
              <button
                onClick={() => setShowAddNoteInput(false)}
                className="text-[9px] font-bold text-slate-400 uppercase tracking-widest"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddNoteInput(true)}
              className={`h-6 px-2 text-xs font-medium text-slate-400 hover:text-indigo-600 rounded-md hover:bg-slate-100 transition-colors ${(entry.notes || []).length ? '' : '-ml-2'}`}
            >
              + Note
            </button>
          )}
        </div>
      </td>

      {/* Row Actions */}
      <td className="py-2 px-2 text-right">
        <div className="inline-flex items-center gap-1 opacity-70 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            className={`${iconButton} hover:text-indigo-600 hover:bg-slate-100`}
            title="Edit entry"
          >
            <PencilIcon />
          </button>
          <button
            onClick={onDelete}
            className={`${iconButton} hover:text-rose-600 hover:bg-rose-50`}
            title="Delete entry"
          >
            <TrashIcon />
          </button>
        </div>
      </td>
    </tr>
  )
}

function CellDisplay({ type, value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-300 text-sm">—</span>
  }

  if (type === 'amount') {
    const num = parseFloat(value) || 0
    return (
      <span className={`text-sm font-semibold tabular-nums ${amountTone(num)}`}>
        {signedINR(num)}
      </span>
    )
  }

  if (type === 'date') {
    if (!value) return <span className="text-slate-300 text-sm">—</span>
    const str = String(value)
    const parts = str.split('-')
    if (parts.length === 3) {
      const [y, m, d] = parts.map(Number)
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        const dateObj = new Date(y, m - 1, d)
        return (
          <span className="text-slate-700 text-sm tabular-nums whitespace-nowrap">
            {dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )
      }
    }
    const d = new Date(value)
    return (
      <span className="text-slate-700 text-sm tabular-nums whitespace-nowrap">
        {!isNaN(d)
          ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
          : str}
      </span>
    )
  }

  if (type === 'number') {
    const n = Number(value)
    return (
      <span className="text-slate-700 text-sm tabular-nums">
        {!isNaN(n) ? n.toLocaleString('en-IN') : String(value)}
      </span>
    )
  }

  return <span className="text-slate-700 text-sm">{String(value)}</span>
}

// ── Modals ───────────────────────────────────────────────────────────────────

function AddCategoryModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('standard')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return alert('Category name is required')

    let columns = []
    if (template === 'people') {
      columns = [
        { id: crypto.randomUUID(), name: 'Date', type: 'date' },
        { id: crypto.randomUUID(), name: 'Amount', type: 'amount' },
        { id: crypto.randomUUID(), name: 'Person', type: 'text' },
        { id: crypto.randomUUID(), name: 'Purpose', type: 'text' },
      ]
    } else if (template === 'rewards') {
      columns = [
        { id: crypto.randomUUID(), name: 'Date', type: 'date' },
        { id: crypto.randomUUID(), name: 'Amount', type: 'amount' },
        { id: crypto.randomUUID(), name: 'Card', type: 'text' },
        { id: crypto.randomUUID(), name: 'Description', type: 'text' },
      ]
    } else {
      // standard default
      columns = [
        { id: crypto.randomUUID(), name: 'Date', type: 'date' },
        { id: crypto.randomUUID(), name: 'Amount', type: 'amount' },
        { id: crypto.randomUUID(), name: 'Description', type: 'text' },
      ]
    }

    onCreate(name.trim(), columns)
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Create New Tracker</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Category Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Money Taken from People, HDFC Rewards..."
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Initial Column Preset</label>
            <select
              value={template}
              onChange={e => setTemplate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm bg-white"
            >
              <option value="standard">Standard (Date, Amount, Description)</option>
              <option value="people">People / Loans (Date, Amount, Person, Purpose)</option>
              <option value="rewards">Card Rewards (Date, Amount, Card, Description)</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">You can customize, add, or remove columns at any time later.</p>
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700 transition-colors mt-6 text-xs uppercase tracking-widest"
          >
            Create Category
          </button>
        </form>
      </div>
    </div>
  )
}

function RenameModal({ tracker, onClose, onSave }) {
  const [name, setName] = useState(tracker.name || '')

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Rename Category</h3>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
        />
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!name.trim()) return alert('Category name cannot be empty')
              onSave(name.trim())
            }}
            className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function ManageColumnsModal({ tracker, onClose, onSaveColumns }) {
  const [columns, setColumns] = useState([...(tracker.columns || [])])
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState('text')

  const handleAddColumn = () => {
    if (!newColName.trim()) return alert('Column name is required')
    const newCol = {
      id: crypto.randomUUID(),
      name: newColName.trim(),
      type: newColType,
    }
    setColumns([...columns, newCol])
    setNewColName('')
    setNewColType('text')
  }

  const handleRenameColumn = (id, newName) => {
    setColumns(columns.map(c => c.id === id ? { ...c, name: newName } : c))
  }

  const handleDeleteColumn = (id) => {
    const colToDelete = columns.find(c => c.id === id)
    if (!colToDelete) return

    if (columns.length <= 1) {
      return alert('A category must have at least one column.')
    }

    // Prevent deleting the last amount column
    const amountCols = columns.filter(c => c.type === 'amount')
    if (colToDelete.type === 'amount' && amountCols.length <= 1) {
      return alert('Each category must have at least one Amount column.')
    }

    // Check if any existing entry has data in this column
    const entriesWithData = (tracker.entries || []).filter(e => {
      const v = e.values?.[id]
      return v !== null && v !== undefined && v !== ''
    }).length

    if (entriesWithData > 0) {
      const confirmDelete = window.confirm(
        `Column "${colToDelete.name}" has data in ${entriesWithData} recorded ${entriesWithData === 1 ? 'entry' : 'entries'
        }. Deleting it will remove that data. Are you sure you want to proceed?`
      )
      if (!confirmDelete) return
    }

    setColumns(columns.filter(c => c.id !== id))
  }

  const moveColumn = (index, direction) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= columns.length) return
    const reordered = [...columns]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    setColumns(reordered)
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">
              Manage Columns — {tracker.name}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Renaming or reordering columns preserves existing entry values
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Existing Columns List */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Current Columns</label>
            <div className="space-y-2">
              {columns.map((col, idx) => (
                <div
                  key={col.id}
                  className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg bg-slate-50/50"
                >
                  <div className="flex flex-col gap-0.5 text-slate-400">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveColumn(idx, -1)}
                      className="hover:text-indigo-600 disabled:opacity-20 text-[10px] leading-none px-1"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={idx === columns.length - 1}
                      onClick={() => moveColumn(idx, 1)}
                      className="hover:text-indigo-600 disabled:opacity-20 text-[10px] leading-none px-1"
                    >
                      ▼
                    </button>
                  </div>

                  <input
                    type="text"
                    value={col.name}
                    onChange={e => handleRenameColumn(col.id, e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-slate-200 rounded bg-white text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />

                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded bg-slate-200/60 text-slate-600">
                    {col.type}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleDeleteColumn(col.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                    title="Delete column"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Add New Column Box */}
          <div className="p-3 border border-indigo-100 rounded-xl bg-indigo-50/20 space-y-2">
            <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest">+ Add New Column</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                placeholder="Column name (e.g. Person, Category, Receipt #)"
                className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg bg-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <select
                value={newColType}
                onChange={e => setNewColType(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="text">Text</option>
                <option value="amount">Amount (₹)</option>
                <option value="date">Date</option>
                <option value="number">Number</option>
              </select>
              <button
                type="button"
                onClick={handleAddColumn}
                className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 uppercase tracking-wider"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const cleaned = columns.map(c => ({
                ...c,
                name: c.name.trim() || 'Untitled Column'
              }))
              onSaveColumns(cleaned)
            }}
            className="px-5 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 uppercase tracking-wider"
          >
            Save Columns
          </button>
        </div>
      </div>
    </div>
  )
}

function EntryModal({ tracker, entry, onClose, onSave }) {
  const isEdit = Boolean(entry)
  const columns = tracker.columns || []
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [values, setValues] = useState(() => {
    return { ...(entry?.values || {}) }
  })

  const [notes, setNotes] = useState(() => {
    return [...(entry?.notes || [])]
  })
  const [newNoteInput, setNewNoteInput] = useState('')

  const handleValueChange = (colId, val) => {
    setValues(prev => ({ ...prev, [colId]: val }))
  }

  const handleAddNote = () => {
    if (newNoteInput.trim()) {
      setNotes(prev => [...prev, newNoteInput.trim()])
      setNewNoteInput('')
    }
  }

  const handleRemoveNote = (idx) => {
    setNotes(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    onSave({
      values,
      notes,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">
            {isEdit ? 'Edit Entry' : `Add Entry — ${tracker.name}`}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {columns.map(col => {
            const val = values[col.id] ?? ''

            return (
              <div key={col.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    {col.name} {col.type === 'amount' && '(₹)'}
                  </label>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{col.type}</span>
                </div>

                {col.type === 'amount' ? (
                  <div className="space-y-1.5">
                    <input
                      type="number"
                      step="any"
                      value={val}
                      onChange={e => handleValueChange(col.id, e.target.value)}
                      placeholder="e.g. 5000 or -999"
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const n = Math.abs(parseFloat(val) || 0)
                          handleValueChange(col.id, n > 0 ? String(n) : '')
                        }}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors uppercase tracking-widest ${(parseFloat(val) || 0) > 0
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'text-slate-400 border-slate-200 hover:bg-slate-50'
                          }`}
                      >
                        + Positive (Income / Receivable)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const n = Math.abs(parseFloat(val) || 0)
                          handleValueChange(col.id, n > 0 ? String(-n) : '')
                        }}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors uppercase tracking-widest ${(parseFloat(val) || 0) < 0
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'text-slate-400 border-slate-200 hover:bg-slate-50'
                          }`}
                      >
                        - Negative (Expense / Payable)
                      </button>
                    </div>
                  </div>
                ) : col.type === 'date' ? (
                  <input
                    type="date"
                    value={val}
                    onChange={e => handleValueChange(col.id, e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                  />
                ) : col.type === 'number' ? (
                  <input
                    type="number"
                    step="any"
                    value={val}
                    onChange={e => handleValueChange(col.id, e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-sm"
                  />
                ) : (
                  <input
                    type="text"
                    value={val}
                    onChange={e => handleValueChange(col.id, e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
                  />
                )}
              </div>
            )
          })}

          {/* Multiple Additional Notes Section */}
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Additional Notes</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {notes.map((note, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full border border-slate-200"
                >
                  <span>{note}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveNote(idx)}
                    className="text-slate-400 hover:text-rose-600 transition-colors"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newNoteInput}
                onChange={e => setNewNoteInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddNote()
                  }
                }}
                placeholder="Add a note..."
                className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleAddNote}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-lg hover:bg-slate-200 uppercase tracking-wider"
              >
                + Note
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700 transition-colors mt-6 text-xs uppercase tracking-widest disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Entry'}
          </button>
        </form>
      </div>
    </div>
  )
}

