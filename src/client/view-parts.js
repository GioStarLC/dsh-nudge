/**
 * The floating window's leaf parts: cards, the note tray and the quick-input form.
 *
 * Every component here is a pure function of its props (and the `t` it is
 * handed); the runtime arrives as callbacks, so these can be read and changed
 * without knowing what else the window holds.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { h } from './react.js'

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

export { CaptureCard, EditCard, AnnotationTray, quickInputForm, popupFrame, noteField, keepFocus }
