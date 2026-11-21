/**
 * The floating window's render tree.
 *
 * The pill, the card, the modules and the overlays that hang off it.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { CHIP_DRAG_SLOP, CHIP_SETTLE_MS, CHIP_SHIFT_MS, DRAG_ROOT_SELECTOR, TIP_ROTATE_MS } from './constants.js'
import { viewCss } from './css.js'
import { chipSlotAt, clampPoint } from './geometry.js'
import { React, h } from './react.js'
import { makeSettingsView } from './settings-view.js'

    /**
     * Build the React view over one runtime.
     * @param runtime - window runtime.
     * @returns the slot component.
     */
    function makeView(runtime) {
      /** The same form the shell section renders, reused by the in-window panel. */
      const SettingsForm = makeSettingsView(runtime)

      /**
       * Write the dragged window's position straight onto its node.
       *
       * A drag is a pointer sample every 4–16 ms. Taking each one through the
       * store re-rendered the whole card — the annotation tray and the prompt
       * row included — for a position only the root element shows. The render
       * keeps owning `left`/`top`; this write exists only between the press and
       * the drop, and the drop commits the same numbers through the store, so
       * the first render after it paints the value the pointer already shows.
       */
      function paintDrag(node, point) {
        const style = node?.style
        if (!style) return
        style.left = `${point.x}px`
        style.top = `${point.y}px`
      }

      const useSyncExternalStore =
        React.useSyncExternalStore ??
        function useSyncExternalStoreFallback(subscribe, getSnapshot) {
          const [value, setValue] = React.useState(getSnapshot)
          React.useEffect(() => {
            setValue(getSnapshot())
            return subscribe(() => setValue(getSnapshot()))
          }, [subscribe, getSnapshot])
          return value
        }

      /** Keep the caret where it is: clicks on the window must not steal focus. */
      function keepFocus(event) {
        event.preventDefault()
      }

      /**
       * The shell both annotation cards share: the floating box, its close
       * button and the dialog semantics. The bodies differ; the frame does not.
       */
      function popupFrame(props) {
        const { t } = props
        return h(
          'div',
          {
            key: props.key,
            className: props.className ? `dsh-nudge-popup ${props.className}` : 'dsh-nudge-popup',
            style: props.style,
            role: 'dialog',
            'aria-label': t('annotationsTitle'),
          },
          h(
            'button',
            {
              key: 'close',
              type: 'button',
              className: 'dsh-nudge-popup-close',
              title: `${t('dismissAnnotation')} (Esc)`,
              'aria-label': t('dismissAnnotation'),
              onClick: props.onClose,
            },
            '×',
          ),
          ...(props.children ?? []),
        )
      }

      /**
       * The note field both cards share: Enter saves, Shift+Enter keeps typing,
       * Escape leaves, and typing never re-reads the page selection.
       */
      function noteField(props) {
        const { t } = props
        return h('textarea', {
          key: 'note',
          ref: props.inputRef,
          rows: props.rows,
          className: props.className,
          value: props.value,
          placeholder: t('annotationPlaceholder'),
          'aria-label': t('annotationPlaceholder'),
          onChange: (event) => props.onChange(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault()
              props.onSubmit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              props.onDismiss()
            }
          },
        })
      }

      /**
       * The selection card: the note field, the two verdicts, save and copy.
       * It deliberately does not repeat the quoted passage; the highlight is
       * where the passage lives.
       */
      function CaptureCard(props) {
        const { t } = props
        return popupFrame({
          key: props.key,
          t,
          style: props.style,
          onClose: props.onDismiss,
          children: [
            noteField({
              t,
              inputRef: props.inputRef,
              rows: 1,
              className: 'dsh-nudge-annotation-input',
              value: props.note,
              onChange: props.onNote,
              onSubmit: props.onSubmit,
              onDismiss: props.onDismiss,
            }),
            h(
              'div',
              { key: 'actions', className: 'dsh-nudge-popup-row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-popup-quick agree',
                  title: t('agree'),
                  'aria-label': t('agree'),
                  onClick: props.onAgree,
                },
                h('span', { className: 'emoji', 'aria-hidden': true }, '👍'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-popup-quick',
                  title: t('disagree'),
                  'aria-label': t('disagree'),
                  onClick: props.onDisagree,
                },
                h('span', { className: 'emoji', 'aria-hidden': true }, '👎'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-popup-save',
                  title: `${t('addAnnotation')} (Enter)`,
                  onClick: props.onSubmit,
                },
                t('addAnnotation'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-popup-copy',
                  title: t('copyHint'),
                  'data-copied': props.copied ? 'true' : undefined,
                  onClick: props.onCopy,
                },
                props.copyLabel,
              ),
            ),
          ],
        })
      }

      /**
       * The in-place editor for one collected note, hung off the passage (or
       * tray row) that was clicked. It owns the edit, so the window never has
       * to unfold or grow for it.
       */
      function EditCard(props) {
        const { t } = props
        return popupFrame({
          key: props.key,
          t,
          style: props.style,
          className: 'dsh-nudge-edit-popup',
          onClose: props.onDismiss,
          children: [
            h('div', { key: 'quote', className: 'dsh-nudge-annotation-quote dsh-nudge-edit-quote' }, props.quote),
            noteField({
              t,
              inputRef: props.inputRef,
              rows: 2,
              className: 'dsh-nudge-annotation-input dsh-nudge-edit-input',
              value: props.note,
              onChange: props.onNote,
              onSubmit: props.onSubmit,
              onDismiss: props.onDismiss,
            }),
            h(
              'div',
              { key: 'actions', className: 'dsh-nudge-popup-row' },
              h(
                'button',
                { type: 'button', className: 'dsh-nudge-edit-delete', onClick: props.onDelete },
                t('deleteAnnotation'),
              ),
              h('button', { type: 'button', onClick: props.onDismiss }, t('dismissAnnotation')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-popup-save',
                  title: `${t('saveAnnotation')} (Enter)`,
                  onClick: props.onSubmit,
                },
                t('saveAnnotation'),
              ),
            ),
            h('div', { key: 'hint', className: 'dsh-nudge-popup-hint' }, h('span', null, t('editNoteHint'))),
          ],
        })
      }

      /**
       * The in-window form that adds or edits one quick input: title, body and
       * the two actions. Both callers differ only in which fields they bind and
       * which class names the form wears, so the shape is written once.
       */
      function quickInputForm(props) {
        const { t } = props
        const onKeyDown = (kind) => (event) => {
          if (event.isComposing) return
          if (event.key === 'Enter' && (kind === 'single' || event.metaKey === true || event.ctrlKey === true)) {
            event.preventDefault()
            props.onSubmit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            props.onCancel()
          }
        }
        return h(
          'div',
          { key: props.key, className: props.className },
          h(
            'div',
            { className: 'dsh-nudge-quick-add-head' },
            h('span', { className: 'dsh-nudge-field-label' }, props.head),
          ),
          h(
            'label',
            { className: 'dsh-nudge-quick-add-field' },
            h('span', { className: 'dsh-nudge-field-label' }, t('quickAddTitle')),
            h('input', {
              ref: props.inputRef,
              type: 'text',
              value: props.label,
              placeholder: t('quickAddTitle'),
              onChange: (event) => props.onLabel(event.target.value),
              onKeyDown: onKeyDown('single'),
            }),
          ),
          h(
            'label',
            { className: 'dsh-nudge-quick-add-field' },
            h('span', { className: 'dsh-nudge-field-label' }, t('quickAddBody')),
            h('textarea', {
              rows: 3,
              value: props.text,
              placeholder: t('quickAddBody'),
              onChange: (event) => props.onText(event.target.value),
              onKeyDown: onKeyDown('multiline'),
            }),
          ),
          props.error ? h('div', { className: 'dsh-nudge-settings-error', role: 'alert' }, props.error) : null,
          h(
            'div',
            { className: 'dsh-nudge-annotation-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn',
                onMouseDown: keepFocus,
                onPointerDown: keepFocus,
                onClick: props.onCancel,
              },
              t('cancelPreset'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-btn primary',
                onMouseDown: keepFocus,
                onPointerDown: keepFocus,
                onClick: props.onSubmit,
              },
              t('savePreset'),
            ),
          ),
        )
      }

      /**
       * The note tray: one fixed-height list, the guide line and the two write
       * actions. The fixed height is the point — a note landing must not resize
       * the window — so the hint and the actions stay mounted when empty.
       */
      function AnnotationTray(props) {
        const { t } = props
        const rows =
          props.annotations.length === 0
            ? [
                h(
                  'div',
                  {
                    key: 'annotation-empty',
                    className: 'dsh-nudge-annotation-hint dsh-nudge-annotation-empty',
                  },
                  props.quick ? t('annotationsHint') : t('annotationsOffHint'),
                ),
              ]
            : props.annotations.map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'dsh-nudge-annotation-item' },
                  h(
                    'div',
                    { className: 'dsh-nudge-annotation-item-head' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-nudge-annotation-open',
                        onClick: (event) =>
                          props.onOpen(item.id, event?.currentTarget?.getBoundingClientRect?.()),
                      },
                      h('span', { className: 'dsh-nudge-annotation-quote', title: item.quote }, item.quote),
                      item.note !== '' ? h('span', { className: 'dsh-nudge-annotation-note' }, item.note) : null,
                      item.written === true
                        ? h('span', { className: 'dsh-nudge-annotation-written' }, t('writtenTag'))
                        : null,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-nudge-annotation-remove',
                        title: t('deleteAnnotation'),
                        'aria-label': t('deleteAnnotation'),
                        onClick: () => props.onRemove(item.id),
                      },
                      '×',
                    ),
                  ),
                ),
              )
        return h(
          'div',
          { className: 'dsh-nudge-module-body' },
          h(
            'div',
            { key: 'annotation-tray', className: 'dsh-nudge-annotation-tray' },
            h(
              'div',
              { key: 'annotation-list', className: 'dsh-nudge-annotation-list', ref: props.listRef },
              ...rows,
            ),
            // Always mounted: the guidance line keeps its height when the first
            // note arrives, so nothing below it moves.
            h(
              'div',
              {
                key: 'annotation-hint',
                className: 'dsh-nudge-annotation-hint dsh-nudge-annotation-guide',
              },
              // Only a painted mark can be clicked, so the hint waits for the
              // quick-notes switch.
              props.annotations.length > 0 && props.quick ? t('highlightHint') : '',
            ),
            // Always mounted too; both buttons simply have nothing to do until a
            // note is waiting.
            h(
              'div',
              { key: 'annotation-actions', className: 'dsh-nudge-annotation-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn',
                  disabled: props.pendingNotes === 0,
                  onClick: props.onWrite,
                },
                t('writeAnnotations'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-nudge-btn primary',
                  disabled: props.pendingNotes === 0,
                  onClick: props.onSend,
                },
                t('sendAnnotations'),
              ),
            ),
          ),
        )
      }

      /** Whether this browser wants the chip motion (reduced motion users do not). */
      function chipMotionOn() {
        try {
          if (typeof window === 'undefined') return false
          return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches !== true
        } catch {
          return false
        }
      }

      /**
       * Every chip's box in view coordinates, measured from its layout
       * (`offsetLeft`/`offsetTop`) rather than its painted rect: a chip that is
       * still sliding from the previous reorder must not skew the next one.
       */
      function chipRowBoxes(row) {
        if (row === null || row === undefined) return []
        let base = null
        try {
          base = typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null
        } catch {
          base = null
        }
        if (base === null) return []
        const boxes = []
        const children = row.children ?? []
        for (let index = 0; index < children.length; index += 1) {
          const node = children[index]
          const id = node?.dataset?.presetId
          if (typeof id !== 'string' || id === '') continue
          boxes.push({
            id,
            node,
            left: base.left + node.offsetLeft,
            top: base.top + node.offsetTop,
            width: node.offsetWidth,
            height: node.offsetHeight,
          })
        }
        return boxes
      }

      /**
       * How far one chip has to travel for its box to land in the new slot:
       * the layout delta, plus any offset still painted from an earlier pass.
       */
      function chipShiftOf(prev, box, axis) {
        const delta = prev[axis] - box[axis]
        let painted = box[axis]
        try {
          const rect = typeof box.node?.getBoundingClientRect === 'function' ? box.node.getBoundingClientRect() : null
          if (rect !== null) painted = rect[axis]
        } catch {
          painted = box[axis]
        }
        return Math.round(delta + (painted - box[axis]))
      }

      /** Put the dragged chip under the pointer, whatever slot its layout took. */
      function paintChipUnderPointer(drag, row) {
        const node = drag?.node
        if (row === null || row === undefined || node === undefined || node === null) return
        let base = null
        try {
          base = typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null
        } catch {
          base = null
        }
        if (base === null) return
        const left = base.left + node.offsetLeft
        const top = base.top + node.offsetTop
        node.style.transform = `translate(${Math.round(drag.lastX - drag.grabX - left)}px, ${Math.round(
          drag.lastY - drag.grabY - top,
        )}px)`
      }

      /**
       * The insertion point the pointer points at, counted against the boxes
       * frozen at the start of the drag. The row does not move while dragging,
       * so the same pointer position always yields the same slot.
       */
      function chipTargetAt(drag) {
        return chipSlotAt(drag.boxes ?? [], drag.id, drag.lastX, drag.lastY)
      }

      /** The caret that shows the slot above, drawn on the frozen boxes. */
      function chipCaretAt(drag, index, row) {
        if (row === null || row === undefined || drag === null) return null
        const rest = (drag.boxes ?? []).filter((box) => box.id !== drag.id)
        if (rest.length === 0) return null
        let base = null
        try {
          base = typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null
        } catch {
          base = null
        }
        if (base === null) return null
        const box = index < rest.length ? rest[index] : rest[rest.length - 1]
        const left = index < rest.length ? box.left - base.left - 2 : box.left + box.width - base.left
        return {
          left: `${Math.round(left)}px`,
          top: `${Math.round(box.top - base.top)}px`,
          height: `${Math.round(box.height)}px`,
        }
      }

      /**
       * The drag one press on a chip starts, or null when the press is not one.
       * The row's boxes are read once, when the press becomes a drag, so a later
       * reorder cannot move the slot under a still pointer.
       */
      function chipDragFrom(event, presetId) {
        if (event === undefined || event === null) return null
        if (event.button !== undefined && event.button !== 0) return null
        if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return null
        const node = event.currentTarget
        if (node === undefined || node === null) return null
        if (typeof node.setPointerCapture === 'function' && event.pointerId !== undefined) {
          try {
            node.setPointerCapture(event.pointerId)
          } catch {
            /* capture is best effort */
          }
        }
        let rect = null
        try {
          rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
        } catch {
          rect = null
        }
        return {
          id: presetId,
          node,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          grabX: rect === null ? 0 : event.clientX - rect.left,
          grabY: rect === null ? 0 : event.clientY - rect.top,
          moved: false,
          /** The row's boxes, read once: the drag is decided against them. */
          boxes: null,
          /** Insertion point among the other chips, or null before the first move. */
          target: null,
        }
      }

      /** Let a dropped chip slide from under the pointer back into its slot. */
      function settleChipNode(node) {
        if (node === undefined || node === null) return
        let from = ''
        try {
          from = typeof window === 'undefined' ? '' : window.getComputedStyle(node).transform
        } catch {
          from = ''
        }
        node.style.transform = ''
        if (from === '' || from === 'none' || chipMotionOn() !== true) return
        if (typeof node.animate !== 'function') return
        try {
          node.animate([{ transform: from }, { transform: 'none' }], {
            duration: CHIP_SETTLE_MS,
            easing: 'ease-out',
          })
        } catch {
          /* the motion is decoration */
        }
      }

      /**
       * The quick-input row: one chip per enabled entry, plus the add and edit
       * chips. In edit mode a chip is a drag handle: a press starts a drag, a
       * release without movement opens that entry, and Enter/left/right do the
       * same from the keyboard. The row itself never reorders mid-drag; the drop
       * commits once.
       */
      function ChipRow(props) {
        const { t } = props
        return h(
          'div',
          {
            ref: props.rowRef,
              className: `dsh-nudge-presets${props.editing ? ' editing' : ''}`,
              role: 'group',
              'aria-label': t('preset'),
            },
            ...props.presets.map((preset) =>
              h(
                'button',
                {
                  key: preset.id,
                  type: 'button',
                  'data-preset-id': preset.id,
                  className: `dsh-nudge-chip${props.activeId === preset.id ? ' active' : ''}${
                    props.editing ? ' dsh-nudge-chip-drag' : ''
                  }${props.editingId === preset.id ? ' editing' : ''}`,
                  title: props.editing ? t('editChipHint') : preset.text,
                  'aria-label': props.editing ? `${t('editPreset')}：${preset.label}` : undefined,
                  onMouseDown: keepFocus,
                  onPointerDown: props.editing ? (event) => props.onBeginDrag(event, preset) : keepFocus,
                  onPointerMove: props.editing ? props.onMoveDrag : undefined,
                  onPointerUp: props.editing ? (event) => props.onEndDrag(event, true) : undefined,
                  onPointerCancel: props.editing ? (event) => props.onEndDrag(event, false) : undefined,
                  onClick: props.editing ? undefined : () => props.onSelect(preset.id),
                  // Keys do what the pointer does: Enter opens the entry, the
                  // arrows hand it to its neighbour. A drag release also fires
                  // a click, so the pointer path stays off `onClick` on purpose.
                  onKeyDown: props.editing
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          props.onEdit(preset.id)
                          return
                        }
                        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                        event.preventDefault()
                        const live = props.presets.map((item) => item.id)
                        const from = live.indexOf(preset.id)
                        const to = from + (event.key === 'ArrowRight' ? 1 : -1)
                        if (from < 0 || to < 0 || to >= live.length) return
                        props.onMoveBeside(preset.id, live[to], event.key === 'ArrowRight')
                      }
                    : undefined,
                  onDoubleClick: props.editing
                    ? undefined
                    : props.onRun
                      ? () => props.onRun(preset.id)
                      : undefined,
                },
                props.editing
                  ? [
                      h('span', { key: 'grip', className: 'dsh-nudge-chip-grip', 'aria-hidden': 'true' }, '⠿'),
                      preset.label,
                    ]
                  : preset.label,
              ),
            ),
            props.caretStyle === null
              ? null
              : h('span', {
                  key: 'drop-caret',
                  className: 'dsh-nudge-chip-caret',
                  style: props.caretStyle,
                  'aria-hidden': 'true',
                }),
            props.presets.length === 0
              ? h(
                  'span',
                  { key: 'no-presets', className: 'dsh-nudge-presets-empty' },
                  t(props.allCount === 0 ? 'presetsEmpty' : 'presetsAllDisabled'),
                )
              : null,
            h(
              'button',
              {
                key: 'add-preset',
                type: 'button',
                className: 'dsh-nudge-chip dsh-nudge-chip-add',
                title: t('addPreset'),
                'aria-label': t('addPreset'),
                'aria-expanded': props.draftOpen,
                onMouseDown: keepFocus,
                onPointerDown: keepFocus,
                onClick: props.onAdd,
              },
              `＋ ${t('quickAdd')}`,
            ),
            props.presets.length > 0
              ? h(
                  'button',
                  {
                    key: 'edit-presets',
                    type: 'button',
                    className: `dsh-nudge-chip dsh-nudge-chip-edit${props.editing ? ' active' : ''}`,
                    title: t('quickEditHint'),
                    'aria-label': t('quickEditHint'),
                    'aria-pressed': props.editing ? 'true' : 'false',
                    onMouseDown: keepFocus,
                    onPointerDown: keepFocus,
                    onClick: props.onToggleEdit,
                  },
                  `✎ ${t('quickEdit')}`,
                )
              : null,
        )
      }

      return function NudgeWindow() {
        const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
        const drag = React.useRef(null)
        /** A drag that moved must not also toggle the pill. */
        const suppressPillClick = React.useRef(false)
        /** A drag that moved must not also collapse the window from its title. */
        const suppressTitleClick = React.useRef(false)
        const popupInputRef = React.useRef(null)
        /** The in-place note editor's field, and the tray list it may scroll. */
        const editInputRef = React.useRef(null)
        const noteListRef = React.useRef(null)
        const quickAddInputRef = React.useRef(null)
        const quickEditInputRef = React.useRef(null)
        /** The chip row: its children hold the layout a reorder is measured from. */
        const chipRowRef = React.useRef(null)
        /** One chip drag in flight; a ref, because a drag must not re-render. */
        const chipDragRef = React.useRef(null)
        /** Chip boxes captured before a reorder, replayed by the FLIP pass below. */
        const chipFlipRef = React.useRef(null)
        /** Where the dropped chip was painted, so the drop can animate from there. */
        const chipSettleRef = React.useRef(null)
        /** Insertion slot the drag currently points at, or null; the caret renders it. */
        const [chipDropIndex, setChipDropIndex] = React.useState(null)
        // The selection card is a writing box: opening it puts the caret straight
        // into the note field so the user can type without clicking first.
        //
        // The focus runs in a layout effect and is retried on the next frame: the
        // shell may hand the focus back to the composer in the same task the card
        // mounts. The captured range is deliberately NOT put back — re-selecting
        // fires a document-wide selectionchange and the browser paints the passage
        // instead of the field, so the card looks unfocused. Extension is done by
        // `onExtendPointerDown` from the draft's own range, which needs no native
        // selection, and the passage stays painted by `::highlight`.
        const useLayoutFocus = React.useLayoutEffect ?? React.useEffect
        useLayoutFocus(() => {
          if (state.annotationDraft === null || state.annotationEditingId !== null) return undefined
          if (state.annotationCardHidden === true) return undefined
          const node = popupInputRef.current
          if (!node || typeof node.focus !== 'function') return undefined
          const focus = () => {
            try {
              node.focus({ preventScroll: true })
            } catch {
              /* unfocusable */
            }
          }
          focus()
          if (typeof window.requestAnimationFrame !== 'function') return undefined
          const frame = window.requestAnimationFrame(() => {
            const active = document.activeElement
            if (active === node) return
            if (runtime.isSelfNode(active)) return
            focus()
          })
          return () => window.cancelAnimationFrame(frame)
        }, [state.annotationDraft, state.annotationCardHidden])
        // The in-place editor is a writing box too: opening it puts the caret at
        // the end of the stored note, so typing appends instead of replacing.
        useLayoutFocus(() => {
          if (state.annotationEditingId === null) return
          const node = editInputRef.current
          if (!node || typeof node.focus !== 'function') return
          try {
            node.focus({ preventScroll: true })
            if (typeof node.setSelectionRange === 'function') {
              const end = typeof node.value === 'string' ? node.value.length : 0
              node.setSelectionRange(end, end)
            }
          } catch {
            /* unfocusable */
          }
        }, [state.annotationEditingId])
        // The tray keeps one height, so a note landing in a scrolled list must
        // bring the list to its bottom: that is the only movement allowed.
        React.useEffect(() => {
          const node = noteListRef.current
          if (!node || typeof node.scrollTo !== 'function') return
          node.scrollTo({ top: node.scrollHeight })
        }, [state.annotations.length])
        // Opening the in-window prompt form puts the caret in the title field.
        React.useEffect(() => {
          if (state.nudgeDraftOpen !== true) return
          const node = quickAddInputRef.current
          if (node && typeof node.focus === 'function') {
            try {
              node.focus({ preventScroll: true })
            } catch {
              /* unfocusable */
            }
          }
        }, [state.nudgeDraftOpen])
        // The in-window editor is a writing box too: the caret lands at the end
        // of the stored title, so opening it never loses a keystroke.
        React.useEffect(() => {
          if (state.nudgeEditId === null) return
          const node = quickEditInputRef.current
          if (!node || typeof node.focus !== 'function') return
          try {
            node.focus({ preventScroll: true })
            if (typeof node.setSelectionRange === 'function') {
              const end = typeof node.value === 'string' ? node.value.length : 0
              node.setSelectionRange(end, end)
            }
          } catch {
            /* unfocusable */
          }
        }, [state.nudgeEditId])
        /** Order of the prompt list; a change is what a drag's FLIP pass reacts to. */
        const chipOrderKey = state.presets.map((preset) => preset.id).join('|')
        // The row is frozen for the whole drag: nothing reorders until the drop, so
        // a long chip can no longer change the wrapping under the pointer and flip
        // the target slot back and forth. What is left is the drop itself — the
        // row takes its new order in one commit, and this pass animates it: the
        // displaced chips from the boxes they had, the dropped chip from wherever
        // the pointer left it.
        useLayoutFocus(() => {
          const before = chipFlipRef.current
          chipFlipRef.current = null
          const settle = chipSettleRef.current
          chipSettleRef.current = null
          const dropped = settle === null ? null : settle.node
          if (before !== null && chipMotionOn()) {
            for (const box of chipRowLayout()) {
              if (box.node === dropped) continue
              const prev = before.get(box.id)
              if (prev === undefined) continue
              const dx = chipShiftOf(prev, box, 'left')
              const dy = chipShiftOf(prev, box, 'top')
              if (dx === 0 && dy === 0) continue
              if (typeof box.node?.animate !== 'function') continue
              try {
                box.node.animate(
                  [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
                  { duration: CHIP_SHIFT_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
                )
              } catch {
                /* the motion is decoration */
              }
            }
          }
          if (settle !== null && chipMotionOn() && typeof settle.node?.animate === 'function') {
            const box = chipRowLayout().find((item) => item.node === settle.node)
            if (box !== undefined) {
              const dx = Math.round(settle.left - box.left)
              const dy = Math.round(settle.top - box.top)
              if (dx !== 0 || dy !== 0) {
                try {
                  settle.node.animate(
                    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
                    { duration: CHIP_SETTLE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
                  )
                } catch {
                  /* the motion is decoration */
                }
              }
            }
          }
          const dragging = chipDragRef.current
          if (dragging !== null && dragging.moved === true) paintChipUnderPointer(dragging, chipRowRef.current)
        }, [chipOrderKey])
        // The status row is never empty: a change message wins while its timer
        // runs, otherwise the idle lines take turns.
        React.useEffect(() => {
          const count = Array.isArray(state.tips) ? state.tips.length : 0
          if (count < 2 || typeof runtime.advanceTip !== 'function') return undefined
          const timer = window.setInterval(() => runtime.advanceTip(), TIP_ROTATE_MS)
          return () => window.clearInterval(timer)
        }, [state.tips.length])
        const t = runtime.text
        const delivery = runtime.effectiveDelivery()
        const draft = state.annotationDraft
        // Copy reports back in place for a moment, the way ds-popup's card does;
        // the timer is reset when the card moves to another passage.
        const [copyFlash, setCopyFlash] = React.useState('')
        const copyFlashTimer = React.useRef(0)
        React.useEffect(
          () => () => {
            window.clearTimeout(copyFlashTimer.current)
          },
          [],
        )
        React.useEffect(() => {
          window.clearTimeout(copyFlashTimer.current)
          setCopyFlash('')
        }, [draft?.quote])
        const copyQuote = () => {
          const pending = runtime.copyDraftQuote()
          Promise.resolve(pending).then((ok) => {
            setCopyFlash(ok === true ? 'done' : 'failed')
            window.clearTimeout(copyFlashTimer.current)
            copyFlashTimer.current = window.setTimeout(() => setCopyFlash(''), 1400)
          })
        }
        const copyLabel =
          copyFlash === 'done'
            ? t('copiedShort')
            : copyFlash === 'failed'
              ? t('copyFailedShort')
              : t('copyQuote')
        const popup =
          state.quick && draft !== null && state.annotationCardHidden !== true
            ? CaptureCard({
                key: 'popup',
                t,
                style: runtime.popupPosition(),
                note: state.annotationNote,
                inputRef: popupInputRef,
                copied: copyFlash === 'done',
                copyLabel,
                onNote: (value) => runtime.setAnnotationNote(value),
                onSubmit: () => runtime.addAnnotation(),
                onDismiss: () => runtime.dismissAnnotationDraft(),
                onCopy: copyQuote,
                onAgree: () => runtime.quickReply('agree'),
                onDisagree: () => runtime.quickReply('disagree'),
              })
            : null
        /** The note the in-place editor is about, or null. */
        const editingItem =
          state.annotationEditingId === null
            ? null
            : (state.annotations.find((item) => item.id === state.annotationEditingId) ?? null)
        /**
         * The in-place editor for one collected note: the same card as the
         * capture bubble, hung off the passage (or tray row) that was clicked.
         * It owns the edit, so the window never has to unfold or grow for it.
         */
        const editPopup =
          state.annotationDraft === null && editingItem !== null
            ? EditCard({
                key: 'edit-popup',
                t,
                style: runtime.editPopupPosition(),
                quote: editingItem.quote,
                note: state.annotationNote,
                inputRef: editInputRef,
                onNote: (value) => runtime.setAnnotationNote(value),
                onSubmit: () => runtime.saveEditedAnnotation(),
                onDismiss: () => runtime.cancelAnnotationEdit(),
                onDelete: () => runtime.removeAnnotation(editingItem.id),
              })
            : null

        const dotClass =
          state.phase === 'waiting' ? 'waiting' : state.phase === 'error' ? 'error' : state.phase === 'done' ? 'done' : ''
        const insertMode = state.composerFocused === true
        const turbo = state.turbo === true
        /** Disabled prompts stay in settings but leave the window row. */
        const livePresets = state.presets.filter((preset) => preset.enabled !== false)
        /** The window's own edit mode: drag to reorder, click one to change it. */
        const editing = state.nudgeEditing === true
        /** The caret the row shows while a chip is being dragged, or null. */
        const chipCaretStyle = editing && chipDropIndex !== null ? chipCaretAt(chipDragRef.current, chipDropIndex, chipRowRef.current) : null
        /** The entry the in-window editor is about, or null once it is disabled. */
        const editingPreset =
          state.nudgeEditId === null
            ? null
            : (livePresets.find((preset) => preset.id === state.nudgeEditId) ?? null)
        /** Notes still waiting to be written into the draft. */
        const pendingNotes = runtime.pendingAnnotations().length
        const attention = state.attentionAt > 0
        const statusLabel =
          state.phase === 'waiting'
            ? t('statusWaiting')
            : state.phase === 'error'
              ? t('statusError')
              : state.phase === 'done'
                ? t('statusDone')
                : t('statusIdle')
        const askLabel = insertMode
          ? t('insert')
          : state.phase === 'waiting'
            ? t('asking')
            : state.phase === 'done' || state.phase === 'error'
              ? t('again')
              : t('ask')
        const askTitle = insertMode ? t('insertHint') : t('askHint')

        /** The row's boxes; the drag is judged against the copy frozen at its start. */
        function chipRowLayout() {
          return chipRowBoxes(chipRowRef.current)
        }

        /**
         * Which slot the pointer is pointing at, counted against the boxes frozen
         * at the start of the drag: the row does not move while dragging, so the
         * same pointer position always yields the same slot — that is what stops
         * a wide chip from flipping its neighbours back and forth. The index is
         * an insertion point among the *other* chips, which is the same thing the
         * drop needs.
         */
        function updateChipTarget(drag) {
          if ((drag.boxes ?? []).length < 2) return
          const index = chipTargetAt(drag)
          if (drag.target === index) return
          drag.target = index
          setChipDropIndex(index)
        }

        /** Begin a press on a chip in edit mode; it becomes a drag past a few px. */
        function beginChipDrag(event, preset) {
          if (state.nudgeEditing !== true) return
          const drag = chipDragFrom(event, preset.id)
          if (drag !== null) chipDragRef.current = drag
        }

        /** Follow the pointer once a press has travelled far enough to be a drag. */
        function moveChipDrag(event) {
          const drag = chipDragRef.current
          if (drag === null) return
          if (typeof event?.clientX !== 'number' || typeof event?.clientY !== 'number') return
          drag.lastX = event.clientX
          drag.lastY = event.clientY
          if (drag.moved !== true) {
            if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < CHIP_DRAG_SLOP) return
            drag.moved = true
            drag.boxes = chipRowLayout()
            try {
              drag.node?.classList?.add('dragging')
            } catch {
              /* the lift is decoration */
            }
          }
          paintChipUnderPointer(drag, chipRowRef.current)
          if (drag.boxes !== null) updateChipTarget(drag)
        }

        /**
         * End a press in edit mode. A press that never moved is a click: it opens
         * that entry's editor. One that moved is a drop: the list is committed to
         * the slot the caret was showing, and the row animates into it.
         */
        function endChipDrag(event, openEditor) {
          const drag = chipDragRef.current
          if (drag === null) return
          chipDragRef.current = null
          if (typeof drag.node?.releasePointerCapture === 'function' && drag.pointerId !== undefined) {
            try {
              drag.node.releasePointerCapture(drag.pointerId)
            } catch {
              /* already released */
            }
          }
          try {
            drag.node?.classList?.remove('dragging')
          } catch {
            /* decoration */
          }
          setChipDropIndex(null)
          if (drag.moved === true) {
            dropChip(drag)
            return
          }
          if (openEditor !== false) runtime.startNudgeEdit(drag.id)
        }

        /**
         * Commit the drop. The row was frozen for the whole drag, so the boxes
         * read at its start are still the ones the pointer was judged against:
         * the target index is an insertion point among the *other* chips, and the
         * same index is what the order needs. One commit here, and the layout
         * effect animates the row into it.
         */
        function dropChip(drag) {
          const node = drag.node
          let left = null
          let top = null
          try {
            const rect = typeof node?.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
            if (rect !== null) {
              left = rect.left
              top = rect.top
            }
          } catch {
            left = null
            top = null
          }
          const rest = (drag.boxes ?? []).filter((box) => box.id !== drag.id)
          const target = drag.target
          if (rest.length === 0 || target === null || target === undefined || left === null) {
            settleChipNode(node)
            return
          }
          const live = state.presets.filter((preset) => preset.enabled !== false).map((preset) => preset.id)
          const current = live.indexOf(drag.id)
          // Dropping on the slot the chip already occupies changes nothing.
          if (current < 0 || target === current) {
            settleChipNode(node)
            return
          }
          chipFlipRef.current = new Map((drag.boxes ?? []).map((box) => [box.id, box]))
          chipSettleRef.current = { node, left, top }
          if (node !== undefined && node !== null) node.style.transform = ''
          const anchor = target < rest.length ? rest[target] : rest[rest.length - 1]
          if (runtime.movePresetBeside(drag.id, anchor.id, target >= rest.length) !== true) {
            chipFlipRef.current = null
            chipSettleRef.current = null
          }
        }

        /** Hover/focus handlers for the explanation bubble of one control. */
        const tipProps = (key) => ({
          onMouseEnter: (event) => runtime.showTip(key, event?.currentTarget?.getBoundingClientRect?.()),
          onMouseLeave: () => runtime.hideTip(),
          onFocus: (event) => runtime.showTip(key, event?.currentTarget?.getBoundingClientRect?.()),
          onBlur: () => runtime.hideTip(),
        })
        /**
         * The spot a click landed on, when a pointer is what clicked. A keyboard
         * activation reports `detail` 0 and no usable coordinates, so it folds
         * from the shared anchor like before.
         */
        function clickPoint(event) {
          if (!event || event.detail === 0) return null
          const x = Number(event.clientX)
          const y = Number(event.clientY)
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null
          return { x, y }
        }
        /** Clicking the window title folds the window into the pill at the pointer. */
        function onNameClick(event) {
          if (suppressTitleClick.current) {
            suppressTitleClick.current = false
            return
          }
          runtime.setCollapsed(true, clickPoint(event))
        }
        /**
         * The title bar captures the pointer for dragging, which retargets the
         * click to the bar itself: fold on the bar, but let its own buttons win.
         */
        function onTitleClick(event) {
          const origin = event?.target
          if (origin && origin !== event.currentTarget && typeof origin.closest === 'function' && origin.closest('button')) {
            return
          }
          onNameClick(event)
        }
        /** Keyboard equivalent of clicking the title. */
        function onNameKeyDown(event) {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onNameClick()
        }
        const gear = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M6.9 1.7h2.2l.4 1.5 1.3.5 1.3-.8 1.6 1.6-.8 1.3.5 1.3 1.5.4v2.2l-1.5.4-.5 1.3.8 1.3-1.6 1.6-1.3-.8-1.3.5-.4 1.5H6.9l-.4-1.5-1.3-.5-1.3.8-1.6-1.6.8-1.3-.5-1.3-1.5-.4V7.5l1.5-.4.5-1.3-.8-1.3 1.6-1.6 1.3.8 1.3-.5.4-1.5Z',
            stroke: 'currentColor',
            strokeWidth: 1.1,
            strokeLinejoin: 'round',
          }),
          h('circle', { cx: 8, cy: 8, r: 2.1, stroke: 'currentColor', strokeWidth: 1.1 }),
        )
        const quoteIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M3.2 3.6h6.2v4.8H6.2L3.2 11V3.6Z',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M12.8 7.4v5h-3.2',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round',
          }),
        )
        /** Auto-paste: a note card flowing into the draft, on focus. */
        const pasteIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('rect', {
            x: 3.2,
            y: 2.4,
            width: 9.6,
            height: 11.2,
            rx: 1.7,
            stroke: 'currentColor',
            strokeWidth: 1.2,
          }),
          h('path', {
            d: 'M6 5.6h4M6 8.4h4M6 11.2h2.2',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round',
          }),
        )
        /** Turbo: a filled bolt, the universal "go fast" mark. */
        const boltIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
          h('path', {
            d: 'M8.9 1.4 2.85 9.05h3.3l-.85 5.55 6.85-8.05h-3.6l.85-5.15Z',
            fill: 'currentColor',
          }),
        )
        /** Delivery "steer": jump the queue and cut in now. */
        const steerIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', { d: 'M2.8 3.3 8.9 8l-6.1 4.7V3.3Z', fill: 'currentColor' }),
          h('path', {
            d: 'M11.9 3.1v9.8',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
          }),
        )
        /** Delivery "queue": wait for the current turn, then go. */
        const queueIcon = h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M2.6 4.6 6.1 8l-3.5 3.4',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
          h('path', {
            d: 'M8.4 4.6 11.9 8l-3.5 3.4',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )
        /**
         * The title mark: a tapping fingertip plus the tap it lands.
         * Colour carries the phase (idle grey / waiting amber / done green / error red);
         * the tap ripple only breathes while a nudge is in flight.
         */
        const markIcon = h(
          'span',
          { className: `dsh-nudge-mark ${dotClass}`, title: statusLabel, 'aria-hidden': true },
          h(
            'svg',
            { width: 16, height: 16, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true },
            h('circle', { className: 'dsh-nudge-mark-tap', cx: 2.6, cy: 2.6, r: 1.9, fill: 'currentColor' }),
            h('path', {
              d: 'M9.6 2.4c.62 0 1.1.5 1.1 1.1v4.1c.1-.6.6-1.05 1.25-1.05.6 0 1.1.45 1.15 1.05.2-.5.65-.8 1.15-.8.7 0 1.2.55 1.2 1.25v5.3a3.3 3.3 0 0 1-3.3 3.3H9.4a3 3 0 0 1-2.1-.85L4.6 13a1 1 0 0 1 1.35-1.45l1.35 1.15V3.5c0-.6.5-1.1 1.1-1.1Z',
              stroke: 'currentColor',
              strokeWidth: 1.8,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          ),
        )

        if (state.collapsed) {
          return h(
            React.Fragment,
            null,
            h('style', { key: 'dsh-nudge-css' }, viewCss(state.quick)),
            h(
              'button',
              {
                key: 'pill',
                type: 'button',
                className: 'dsh-nudge-pill',
                style: { left: `${state.pos.x}px`, top: `${state.pos.y}px`, '--dn-frame': `${state.frame}px` },
                title: t('expand'),
                'aria-label': t('expand'),
                onClick: onPillClick,
                onPointerDown: onPillPointerDown,
                onPointerMove: onPillPointerMove,
                onPointerUp: onPillPointerUp,
                onPointerCancel: onPillPointerUp,
              },
              markIcon,
              state.unread ? h('span', { className: 'dsh-nudge-unread', title: t('newResult') }) : null,
            ),
            popup,
            editPopup,
          )
        }

        /**
         * Start one pointer drag from the current anchor. The collapsed pill is
         * itself a button, so its own press must not be filtered out by the
         * "buttons keep their own pointer handling" rule.
         */
        function beginDrag(event, allowButtonRoot = false) {
          if (event.button !== 0) return
          // Capturing the pointer on the bar retargets the click away from a
          // button inside it, so buttons keep their own pointer handling.
          const origin = event.target
          if (
            !allowButtonRoot &&
            origin &&
            typeof origin.closest === 'function' &&
            origin.closest('button')
          ) {
            return
          }
          // A previous drag may have ended outside the pill without a click;
          // never let that stale suppression swallow the next real click.
          suppressPillClick.current = false
          // The press lands on the title bar (inside the card) or on the pill
          // itself; the position belongs to the root those live in.
          const root = event.currentTarget
          const node =
            root && typeof root.closest === 'function'
              ? root.closest(DRAG_ROOT_SELECTOR) ?? root
              : root
          drag.current = {
            dx: event.clientX - state.pos.x,
            dy: event.clientY - state.pos.y,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            x: state.pos.x,
            y: state.pos.y,
            node,
          }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }

        /** Move while dragging; a tiny movement stays a click. */
        function moveDrag(event) {
          const current = drag.current
          if (!current) return
          if (!current.moved) {
            const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
            if (distance > 3) current.moved = true
          }
          if (!current.moved) return
          // No store write per sample: the node follows the pointer, the store
          // hears about the final spot once, on drop.
          const point = clampPoint(
            { x: event.clientX - current.dx, y: event.clientY - current.dy },
            state.collapsed,
          )
          current.x = point.x
          current.y = point.y
          paintDrag(current.node, point)
        }

        /** Finish one drag, committing the final position once. */
        function endDrag() {
          const current = drag.current
          drag.current = null
          if (!current || !current.moved) return
          runtime.moveTo(current.x, current.y)
          runtime.saveUi()
        }

        function onPointerDown(event) {
          if (event.button !== 0) return
          if (typeof event.target?.closest === 'function' && event.target.closest('button')) return
          beginDrag(event)
          event.preventDefault()
        }

        function onPointerMove(event) {
          moveDrag(event)
        }

        /** Finish a title-bar drag; a plain click on the title folds the window. */
        function onPointerUp() {
          const current = drag.current
          if (current && current.moved) suppressTitleClick.current = true
          endDrag()
        }

        /** A cancelled pointer must never be treated as a click. */
        function onPointerCancel() {
          endDrag()
        }

        function onPillPointerDown(event) {
          beginDrag(event, true)
        }

        function onPillPointerMove(event) {
          moveDrag(event)
        }

        function onPillPointerUp() {
          const current = drag.current
          if (current && current.moved) suppressPillClick.current = true
          endDrag()
        }

        function onPillClick() {
          if (suppressPillClick.current) {
            suppressPillClick.current = false
            return
          }
          runtime.setCollapsed(false)
        }

        /** Place the explanation bubble below its control, flipping when short on room. */
        function tipPosition(box) {
          const width = 224
          const viewportWidth =
            typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 360
          const viewportHeight =
            typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 720
          const center = (box.left + box.right) / 2
          const left = Math.min(Math.max(8, center - width / 2), Math.max(8, viewportWidth - width - 8))
          const below = box.bottom + 6
          const flip = below + 92 > viewportHeight
          return {
            left: `${Math.round(left)}px`,
            top: `${Math.round(flip ? box.top - 6 : below)}px`,
            width: `${width}px`,
            ...(flip ? { transform: 'translateY(-100%)' } : null),
          }
        }

        /** Title, live state and one-line purpose of a window control. */
        function tipSpecOf(key) {
          if (key === 'quick') {
            return { title: t('quickTitle'), state: state.quick ? t('tipOn') : t('tipOff'), hint: t('quickTip') }
          }
          if (key === 'autopaste') {
            return {
              title: t('autoPasteTitle'),
              state: state.autoPaste ? t('tipOn') : t('tipOff'),
              hint: t('autoPasteTip'),
            }
          }
          if (key === 'delivery') {
            const steer = delivery === 'steer'
            return {
              title: t('deliveryTitle'),
              state: steer ? t('steer') : t('queue'),
              hint: steer ? t('deliveryTipSteer') : t('deliveryTipQueue'),
            }
          }
          if (key === 'turbo') {
            return { title: t('turboTitle'), state: turbo ? t('tipOn') : t('tipOff'), hint: t('turboTip') }
          }
          if (key === 'settings') {
            return { title: t('openSettings'), state: '', hint: t('settingsTip') }
          }
          return null
        }
        const tipSpec = state.tip === null ? null : tipSpecOf(state.tip.key)
        const tipStyle = state.tip === null || tipSpec === null ? null : tipPosition(state.tip)

        return h(
          React.Fragment,
          null,
          h(
          'div',
          {
            key: 'card',
            className: 'dsh-nudge-card',
            role: 'dialog',
            'aria-label': t('title'),
            style: { left: `${state.pos.x}px`, top: `${state.pos.y}px`, '--dn-frame': `${state.frame}px` },
          },
          h('style', { key: 'dsh-nudge-css' }, viewCss(state.quick)),
          attention
            ? h('span', { key: `attention-${state.attentionAt}`, className: 'dsh-nudge-attention-ring', 'aria-hidden': true })
            : null,
          h(
            'div',
            {
              key: 'title',
              className: 'dsh-nudge-title',
              title: t('collapseHint'),
              onClick: onTitleClick,
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel,
            },
            markIcon,
            h(
              'span',
              {
                className: 'dsh-nudge-name',
                role: 'button',
                tabIndex: 0,
                title: t('foldHint'),
                'aria-label': `${t('title')}：${t('foldHint')}`,
                onClick: onNameClick,
                onKeyDown: onNameKeyDown,
              },
              t('title'),
            ),
            h('span', { className: 'dsh-nudge-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-nudge-icon',
                'aria-label': t('openSettings'),
                ...tipProps('settings'),
                onClick: () => {
                  // A second press leaves the in-window form, like any toggle.
                  if (state.settingsOpen) runtime.closeSettings()
                  else runtime.openSettings()
                },
                onPointerDown: (event) => {
                  // The bar starts a drag on pointerdown; a press here must not
                  // be swallowed by it (and must not move the window).
                  event.stopPropagation()
                  runtime.noteSettingsPress()
                },
              },
              gear,
            ),
          ),
          state.error.length > 0
            ? h('div', { key: 'error', className: 'dsh-nudge-alert error' }, state.error)
            : null,
          state.note.length > 0
            ? h('div', { key: 'note', className: 'dsh-nudge-alert note' }, state.note)
            : null,
          // Always mounted: this row is the window's status bar now, and a row
          // that appeared only while a message was up would resize the whole
          // floating window every time a switch is toggled. An empty string
          // keeps the line box (see `.dsh-nudge-flash`) so the height is fixed.
          h(
            'div',
            {
              key: 'flash',
              className: `dsh-nudge-flash${state.flash.length > 0 ? ' active' : ''}`,
              role: 'status',
              'aria-live': 'polite',
            },
            state.flash.length > 0
              ? state.flash
              : state.tips.length > 0
                ? state.tips[state.tipIndex % state.tips.length]
                : '',
          ),
          state.settingsOpen
            ? h(
                'div',
                {
                  key: 'settings-panel',
                  className: 'dsh-nudge-settings-panel',
                  role: 'region',
                  'aria-label': t('settingsTitle'),
                },
                h(
                  'div',
                  { key: 'settings-head', className: 'dsh-nudge-settings-head' },
                  h('span', { className: 'dsh-nudge-settings-name' }, t('settingsHead')),
                  h('span', { className: 'dsh-nudge-spacer' }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-nudge-icon',
                      title: t('back'),
                      'aria-label': t('back'),
                      onClick: () => runtime.closeSettings(),
                    },
                    '×',
                  ),
                ),
                h(SettingsForm, { key: 'settings-form' }),
              )
            : h(
            'div',
            { key: 'content', className: 'dsh-nudge-content' },
            h(
              'div',
              { key: 'annotation-module', className: 'dsh-nudge-module' },
              h(
                'div',
                { key: 'annotation-head', className: 'dsh-nudge-module-head' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-nudge-module-main',
                    title: state.annotationExpanded ? t('collapseAnnotations') : t('expandAnnotations'),
                    'aria-expanded': state.annotationExpanded ? 'true' : 'false',
                    onClick: () => runtime.setAnnotationExpanded(!state.annotationExpanded),
                  },
                  h('span', { className: 'dsh-nudge-module-title' }, t('annotationsTitle')),
                  state.annotations.length > 0
                    ? h('span', { className: 'dsh-nudge-annotations-count' }, String(state.annotations.length))
                    : null,
                ),
                h('span', { className: 'dsh-nudge-spacer' }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `dsh-nudge-head-icon dsh-nudge-annotation-quick${state.quick ? ' active' : ''}`,
                    'aria-label': state.quick ? t('quickOn') : t('quickOff'),
                    'aria-pressed': state.quick ? 'true' : 'false',
                    ...tipProps('quick'),
                    onClick: () => runtime.setQuick(!state.quick),
                  },
                  quoteIcon,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `dsh-nudge-head-icon dsh-nudge-annotation-autopaste${state.autoPaste ? ' active' : ''}`,
                    'aria-label': state.autoPaste ? t('autoPasteOn') : t('autoPasteOff'),
                    'aria-pressed': state.autoPaste ? 'true' : 'false',
                    ...tipProps('autopaste'),
                    onClick: () => runtime.setAutoPaste(!state.autoPaste),
                  },
                  pasteIcon,
                ),
              ),
              state.annotationExpanded
                ? AnnotationTray({
                    t,
                    annotations: state.annotations,
                    quick: state.quick,
                    pendingNotes,
                    listRef: noteListRef,
                    onOpen: (id, rect) => runtime.startEditAnnotation(id, rect),
                    onRemove: (id) => runtime.removeAnnotation(id),
                    onWrite: () => runtime.writeAnnotations(),
                    onSend: () => runtime.sendAnnotations(),
                  })
                : null,
            ),
            h(
              'div',
              { key: 'nudge-module', className: 'dsh-nudge-module' },
              h(
                'div',
                { key: 'nudge-head', className: 'dsh-nudge-module-head' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-nudge-module-main',
                    title: state.nudgeExpanded ? t('collapseNudge') : t('expandNudge'),
                    'aria-expanded': state.nudgeExpanded ? 'true' : 'false',
                    onClick: () => runtime.setNudgeExpanded(!state.nudgeExpanded),
                  },
                  h('span', { className: 'dsh-nudge-module-title' }, t('nudgeModule')),
                ),
                h('span', { className: 'dsh-nudge-spacer' }),
                h(
                  'div',
                  { className: 'dsh-nudge-module-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `dsh-nudge-head-icon dsh-nudge-delivery-toggle${insertMode ? ' inactive' : ''}${
                        delivery === 'steer' ? ' steer' : ''
                      }`,
                      'aria-label': `${t('mode')}：${delivery === 'steer' ? t('steer') : t('queue')}`,
                      disabled: insertMode,
                      ...tipProps('delivery'),
                      onClick: () => runtime.setDelivery(delivery === 'steer' ? 'followup' : 'steer'),
                    },
                    delivery === 'steer' ? steerIcon : queueIcon,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `dsh-nudge-head-icon dsh-nudge-turbo-toggle${turbo ? ' active' : ''}`,
                      'aria-label': `${t('turboTitle')}：${turbo ? t('switchOn') : t('switchOff')}`,
                      'aria-pressed': turbo ? 'true' : 'false',
                      ...tipProps('turbo'),
                      onClick: () => runtime.setTurbo(!turbo),
                    },
                    boltIcon,
                  ),
                ),
              ),
              state.nudgeExpanded
                ? h(
                    'div',
                    { className: 'dsh-nudge-module-body' },
                    h(
                      'div',
                      { key: 'presets', className: 'dsh-nudge-field' },
              ChipRow({
                t,
                presets: livePresets,
                activeId: state.presetId,
                editing,
                editingId: state.nudgeEditId,
                caretStyle: chipCaretStyle,
                draftOpen: state.nudgeDraftOpen === true,
                allCount: state.presets.length,
                rowRef: chipRowRef,
                onSelect: (id) => runtime.setPreset(id),
                onRun: turbo ? (id) => runtime.runPreset(id) : undefined,
                onEdit: (id) => runtime.startNudgeEdit(id),
                onMoveBeside: (id, anchorId, after) => runtime.movePresetBeside(id, anchorId, after),
                onBeginDrag: (event, preset) => beginChipDrag(event, preset),
                onMoveDrag: moveChipDrag,
                onEndDrag: (event, openEditor) => endChipDrag(event, openEditor),
                onAdd: () => runtime.startNudgeDraft(),
                onToggleEdit: () => runtime.setNudgeEditing(!editing),
              }),
              state.nudgeEditId !== null && editingPreset !== null
                ? quickInputForm({
                    key: 'quick-edit',
                    t,
                    className: 'dsh-nudge-quick-edit',
                    head: t('editPresetHead'),
                    inputRef: quickEditInputRef,
                    label: state.nudgeEditLabel,
                    text: state.nudgeEditText,
                    error: state.nudgeEditError,
                    onLabel: (value) => runtime.setNudgeEditLabel(value),
                    onText: (value) => runtime.setNudgeEditText(value),
                    onSubmit: () => runtime.saveNudgeEdit(),
                    onCancel: () => runtime.cancelNudgeEdit(),
                  })
                : null,
              state.nudgeDraftOpen === true
                ? quickInputForm({
                    key: 'quick-add',
                    t,
                    className: 'dsh-nudge-quick-add',
                    head: t('addPreset'),
                    inputRef: quickAddInputRef,
                    label: state.nudgeDraftLabel,
                    text: state.nudgeDraftText,
                    error: state.nudgeDraftError,
                    onLabel: (value) => runtime.setNudgeDraftLabel(value),
                    onText: (value) => runtime.setNudgeDraftText(value),
                    onSubmit: () => runtime.saveNudgeDraft(),
                    onCancel: () => runtime.cancelNudgeDraft(),
                  })
                : null,
            ),
            turbo
              ? null
              : h(
                  'button',
                  {
                    key: 'ask',
                    type: 'button',
                    className: `dsh-nudge-ask${insertMode ? ' insert' : ''}`,
                    title: askTitle,
                    'aria-label': askTitle,
                    disabled: livePresets.length === 0 || (!insertMode && state.phase === 'waiting'),
                    onMouseDown: keepFocus,
                    onPointerDown: keepFocus,
                    onClick: () => {
                      runtime.ask()
                    },
                  },
                  askLabel,
                ),
                  )
                : null,
            ),
          ),
          popup,
          editPopup,
          tipSpec !== null && tipStyle !== null
            ? h(
                'div',
                { key: 'tip', className: 'dsh-nudge-tip', role: 'tooltip', style: tipStyle },
                h(
                  'div',
                  { className: 'dsh-nudge-tip-head' },
                  h('span', { className: 'dsh-nudge-tip-title' }, tipSpec.title),
                  tipSpec.state === '' ? null : h('span', { className: 'dsh-nudge-tip-state' }, tipSpec.state),
                ),
                tipSpec.hint === '' ? null : h('div', { className: 'dsh-nudge-tip-hint' }, tipSpec.hint),
              )
            : null,
        ),
        )
      }
    }

    // ---------------------------------------------------------------------
    // settings view
    // ---------------------------------------------------------------------

export { makeView }
