/**
 * The in-window prompt row: the chips, the drag geometry and the settle motion.
 *
 * The row is a pure function of its props; the drag helpers are pure functions
 * of the nodes and boxes their caller passes in.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { CHIP_SETTLE_MS } from './constants.js'
import { chipSlotAt } from './geometry.js'
import { React, h } from './react.js'
import { keepFocus } from './view-parts.js'

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


export { ChipRow, chipMotionOn, chipRowBoxes, chipShiftOf, paintChipUnderPointer, chipTargetAt, chipCaretAt, chipDragFrom, settleChipNode }
