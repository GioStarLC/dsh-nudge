/**
 * The floating window stylesheet.
 *
 * One template string plus the two rules that depend on runtime flags.
 *
 * Built into `client.js` by `scripts/build.mjs`; edit this file, not the bundle.
 */
import { Z_INDEX } from './constants.js'
import { clamp } from './geometry.js'

    /**
     * The conversation renders selection actions into this one surface, and the
     * official 「引用文本」 action is its only occupant. While quick notes own
     * the selection, that surface stays out of the way; turning the notes off
     * drops the rule and hands the selection back.
     */
    const OFFICIAL_SELECTION_CSS = '[data-text-interaction-surface]{display:none!important}'

    /** The hide rule, appended to the window stylesheet while quick notes are on. */
    function viewCss(quick) {
      return quick === true ? `${CSS}\n${OFFICIAL_SELECTION_CSS}` : CSS
    }

    const CSS = `
.dsh-nudge-card,.dsh-nudge-pill,.dsh-nudge-settings,.dsh-nudge-popup{--dn-accent:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 78%,var(--dsw-alias-label-primary,#1a1a1a) 22%);--dn-accent-soft:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 14%,transparent);--dn-accent-line:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 38%,transparent);--dn-accent-edge:color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 62%,transparent);--dn-line:var(--dsw-alias-border-l1,rgba(127,127,127,.25));--dn-line-strong:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 28%,transparent);--dn-hover:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 6%,transparent);--dn-note:#8b5cf6;--dn-frame:1px}
.dsh-nudge-card{position:fixed;z-index:${Z_INDEX};width:min(304px,calc(100vw - 24px));display:flex;flex-direction:column;border-radius:16px;border:var(--dn-frame) solid var(--dn-accent-edge);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 1px 2px rgba(15,23,42,.04),0 18px 44px -22px rgba(15,23,42,.3);font:13px/1.55 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden;pointer-events:auto;animation:dsh-nudge-in .18s ease-out}
@keyframes dsh-nudge-in{from{opacity:0;transform:translateY(-5px) scale(.985)}to{opacity:1;transform:none}}
.dsh-nudge-title{display:flex;align-items:center;gap:8px;padding:12px 12px 10px 14px;cursor:grab;user-select:none;touch-action:none;border-bottom:1px solid var(--dn-line)}
.dsh-nudge-title:active{cursor:grabbing}
.dsh-nudge-name{font-size:12.5px;font-weight:600;letter-spacing:.2px;cursor:pointer;border-radius:5px;padding:2px 4px;margin:-2px -4px;transition:background .15s ease,color .15s ease}
.dsh-nudge-name:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-name:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-spacer{flex:1 1 auto}
.dsh-nudge-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:16px;height:16px;color:var(--dsw-alias-state-idle-primary,#9a9aa4);transition:color .2s ease}
.dsh-nudge-mark svg{display:block;overflow:visible}
.dsh-nudge-mark .dsh-nudge-mark-tap{opacity:.55;transition:opacity .2s ease}
.dsh-nudge-mark.waiting{color:var(--dsw-alias-state-warn-primary,#d99b1e)}
.dsh-nudge-mark.waiting .dsh-nudge-mark-tap{opacity:1;transform-box:fill-box;transform-origin:center;animation:dsh-nudge-tap 2s ease-in-out infinite}
.dsh-nudge-mark.done{color:var(--dsw-alias-state-success-primary,#2f9e63)}
.dsh-nudge-mark.done .dsh-nudge-mark-tap{opacity:0}
.dsh-nudge-mark.error{color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-mark.error .dsh-nudge-mark-tap{opacity:0}
@keyframes dsh-nudge-tap{0%{opacity:.45;transform:scale(.94)}55%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1)}}
@keyframes dsh-nudge-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dsh-nudge-icon{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-nudge-icon:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-icon:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-alert{margin:10px 14px 0;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.5;word-break:break-word}
.dsh-nudge-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 10%,transparent);color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-alert.note{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d99b1e) 12%,transparent);color:var(--dsw-alias-state-warn-primary,#a06a00)}
.dsh-nudge-flash{margin:8px 14px 0;font-size:11.5px;line-height:1.4;min-height:16px;color:var(--dn-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-nudge-flash.active{animation:dsh-nudge-flash-in .16s ease-out}
@keyframes dsh-nudge-flash-in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
.dsh-nudge-content{display:flex;flex-direction:column;gap:12px;padding:12px 14px 14px}
.dsh-nudge-field{display:flex;flex-direction:column;gap:7px;min-width:0}
.dsh-nudge-field-inline{flex-direction:row;align-items:center;gap:10px}
.dsh-nudge-field-inline .dsh-nudge-field-label{flex:0 0 auto}
.dsh-nudge-field-label{font-size:11px;font-weight:600;letter-spacing:.4px;color:var(--dsw-alias-label-secondary,#6a6a76)}
.dsh-nudge-presets{display:flex;flex-wrap:wrap;gap:6px;position:relative}
.dsh-nudge-presets-empty{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-chip{height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--dn-line);background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-nudge-chip:hover{border-color:var(--dn-accent-line);color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dn-accent-soft)}
.dsh-nudge-chip:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-chip.active{background:var(--dn-accent-soft);border-color:var(--dn-accent-line);color:var(--dn-accent);font-weight:600}
.dsh-nudge-chip.dsh-nudge-chip-add{border-style:dashed;color:var(--dn-accent)}
.dsh-nudge-chip.dsh-nudge-chip-edit{border-style:dashed;color:var(--dn-accent)}
/* Edit mode: a chip is a handle and a target, so the pointer owns its motion
   and text selection stays out of the way. */
.dsh-nudge-presets.editing .dsh-nudge-chip{touch-action:none}
.dsh-nudge-presets.editing .dsh-nudge-chip:not(.dsh-nudge-chip-edit):not(.dsh-nudge-chip-add){cursor:grab;user-select:none}
.dsh-nudge-chip-grip{display:inline-block;margin-right:4px;font-size:10px;line-height:1;opacity:.6;pointer-events:none}
/* The drop caret: where the dragged chip lands. It is the only thing that
   moves while dragging — the row itself stays frozen. */
.dsh-nudge-chip-caret{position:absolute;z-index:2;width:3px;border-radius:2px;background:var(--dn-accent);pointer-events:none;animation:dsh-nudge-caret-in .12s ease-out;transition:left .1s ease,top .1s ease,height .1s ease}
@keyframes dsh-nudge-caret-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.dsh-nudge-chip-caret{animation:none;transition:none}}
.dsh-nudge-chip.dsh-nudge-chip-drag{position:relative;z-index:1;will-change:transform}
.dsh-nudge-chip.dsh-nudge-chip-drag.dragging{z-index:3;cursor:grabbing;border-color:var(--dn-accent-line);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 10px 22px -10px rgba(15,23,42,.55)}
.dsh-nudge-chip.dsh-nudge-chip-drag.editing{border-color:var(--dn-accent-line);background:var(--dn-accent-soft);color:var(--dn-accent)}
.dsh-nudge-quick-add{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dn-accent-line);border-radius:12px;background:var(--dn-accent-soft)}
.dsh-nudge-quick-add-field{display:flex;flex-direction:column;gap:4px}
.dsh-nudge-quick-add input,.dsh-nudge-quick-add textarea{width:100%;box-sizing:border-box;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;padding:6px 9px;outline:none}
.dsh-nudge-quick-add input{height:30px}
.dsh-nudge-quick-add textarea{min-height:64px;max-height:132px;line-height:1.5;resize:none;overflow-y:auto}
.dsh-nudge-quick-add input:focus,.dsh-nudge-quick-add textarea:focus{border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
/* The in-window editor for one quick input: the add form's shape, its own
   class so the add block keeps one meaning per selector. */
.dsh-nudge-quick-edit{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dn-accent-line);border-radius:12px;background:var(--dn-accent-soft)}
.dsh-nudge-quick-edit input,.dsh-nudge-quick-edit textarea{width:100%;box-sizing:border-box;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;padding:6px 9px;outline:none}
.dsh-nudge-quick-edit input{height:30px}
.dsh-nudge-quick-edit textarea{min-height:64px;max-height:132px;line-height:1.5;resize:none;overflow-y:auto}
.dsh-nudge-quick-edit input:focus,.dsh-nudge-quick-edit textarea:focus{border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-ask{height:38px;border:0;border-radius:11px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;letter-spacing:.2px;color:var(--dsw-alias-label-primary-inverted,#fff);background:var(--dn-accent);box-shadow:0 8px 20px -10px color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 55%,transparent);transition:filter .15s ease,transform .1s ease,box-shadow .15s ease}
.dsh-nudge-ask:hover{filter:brightness(1.05);box-shadow:0 10px 24px -10px color-mix(in srgb,var(--dsw-static-deepseek-450,#5686fe) 65%,transparent)}
.dsh-nudge-ask:active{transform:translateY(1px)}
.dsh-nudge-ask:disabled{opacity:.55;cursor:default;box-shadow:none;filter:none}
.dsh-nudge-ask:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-annotation-quote{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.dsh-nudge-annotation-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
/* 340 is also the width popupPosition()/placeOverRect() lay the card out with:
   change one and the card drifts off its anchor and past the viewport edge. */
.dsh-nudge-popup{position:fixed;z-index:${Z_INDEX + 1};box-sizing:border-box;width:340px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 10px 30px rgba(0,0,0,.16),0 2px 8px rgba(0,0,0,.08);font:13px/1.45 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;pointer-events:auto;opacity:.72;transition:opacity .22s ease;animation:dsh-nudge-popup-in .12s cubic-bezier(.16,1,.3,1)}
.dsh-nudge-popup:hover,.dsh-nudge-popup:focus-within{opacity:1}
/* The end state stays open on purpose: the card takes the focus in the frame
   it mounts, so :focus-within makes its resting opacity 1 — a fixed
   to{opacity:.72} would snap to the real value on the last frame. scale is
   its own property so it never overwrites the inline translateY that places
   an upward-opening card. */
@keyframes dsh-nudge-popup-in{from{opacity:0;scale:.97}}
@media (prefers-reduced-motion:reduce){.dsh-nudge-popup{animation:none;transition:none}}
.dsh-nudge-settings-panel{display:flex;flex-direction:column;gap:10px;padding:12px;flex:1 1 auto;min-height:0;max-height:min(520px,72vh);overflow:auto}
.dsh-nudge-settings-head{display:flex;align-items:center;gap:8px}
.dsh-nudge-settings-name{font:inherit;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-popup-row{display:flex;align-items:center;gap:6px}
.dsh-nudge-popup-row button{height:28px;padding:0 8px;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,transform .12s ease}
.dsh-nudge-popup-row button:active{transform:scale(.97)}
.dsh-nudge-popup-row button:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-popup-mic{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid var(--dn-line);border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:11px;line-height:1;cursor:pointer}
.dsh-nudge-popup-mic-hint{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#5a5a66)}
/* One action style for the whole card: same height, radius and type, and only
   one primary. The actions size themselves by their words, so the longer
   verdict labels stay readable; copying is a utility and sits with the field. */
.dsh-nudge-popup-field{display:flex;align-items:flex-start;gap:6px}
.dsh-nudge-popup-field .dsh-nudge-annotation-input{flex:1 1 auto;min-width:0}
.dsh-nudge-popup-copy{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#5a5a66);cursor:pointer;transition:color .12s ease,background-color .12s ease,border-color .12s ease}
.dsh-nudge-popup-copy:hover{color:var(--dn-accent);background:var(--dn-hover)}
.dsh-nudge-popup-copy:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-popup-copy[data-copied="done"]{color:var(--dn-accent);border-color:var(--dn-accent-line);background:var(--dn-accent-soft)}
.dsh-nudge-popup-copy[data-copied="failed"]{color:var(--dsw-alias-state-error-primary,#c8433c);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 45%,transparent)}
.dsh-nudge-popup-row .dsh-nudge-popup-quick:hover{background:var(--dn-hover)}
.dsh-nudge-popup-row .dsh-nudge-popup-answer{border-color:var(--dsw-static-deepseek-450,#5686fe);background:var(--dsw-static-deepseek-450,#5686fe);color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600}
.dsh-nudge-popup-row .dsh-nudge-popup-answer:hover{filter:brightness(1.06)}
.dsh-nudge-popup-hint{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-popup-hint kbd{font:inherit;padding:0 3px;border:1px solid var(--dn-line);border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 4%,transparent)}
/* The in-place note editor: the capture card's shape, hung off the passage.
   It sits fully opaque because it holds a field the user types into, and its
   field starts two lines tall so a stored note is readable at a glance. */
.dsh-nudge-edit-popup{opacity:1}
.dsh-nudge-edit-quote{max-height:34px;-webkit-line-clamp:2;min-height:0}
.dsh-nudge-edit-popup .dsh-nudge-annotation-input{min-height:56px}
.dsh-nudge-popup-row .dsh-nudge-edit-delete{margin-right:auto;border-color:transparent;background:transparent;color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-popup-row .dsh-nudge-edit-delete:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 10%,transparent)}
.dsh-nudge-annotation-input{width:100%;box-sizing:border-box;min-height:34px;field-sizing:content;max-height:132px;resize:none;overflow-y:auto;border:1px solid var(--dn-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:13px;line-height:20px;padding:7px 10px}
.dsh-nudge-annotation-input:disabled{opacity:.6;cursor:not-allowed}
.dsh-nudge-btn:disabled{opacity:.45;cursor:default}
.dsh-nudge-annotation-input:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-annotation-actions{display:flex;justify-content:flex-end;gap:8px}
.dsh-nudge-annotations-count{min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--dn-accent-soft);color:var(--dn-accent);font-size:10px;line-height:16px;text-align:center}
/* One fixed-height tray: rows scroll inside it, so adding a note never grows
   the floating window. The guide line and the action row keep their own rows. */
.dsh-nudge-annotation-tray{display:flex;flex-direction:column;gap:8px;height:216px}
.dsh-nudge-annotation-list{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:6px;overflow-y:auto;scrollbar-gutter:stable}
.dsh-nudge-annotation-empty{display:flex;align-items:center;justify-content:center;box-sizing:border-box;height:100%;padding:0 10px;border:1px dashed var(--dn-line);border-radius:12px;color:var(--dsw-alias-label-secondary,#8a8a8a);text-align:center}
.dsh-nudge-annotation-guide{flex:0 0 auto;min-height:16px;max-height:33px;overflow:hidden}
.dsh-nudge-annotation-item{display:flex;flex-direction:column;gap:3px;padding:7px 8px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 5%,transparent)}
.dsh-nudge-annotation-item-head{display:flex;align-items:flex-start;gap:6px}
.dsh-nudge-annotation-item-head .dsh-nudge-annotation-quote{flex:1 1 auto;min-width:0;-webkit-line-clamp:2}
.dsh-nudge-annotation-written{flex:0 0 auto;font-size:10px;line-height:1.6;padding:0 4px;border-radius:4px;color:color-mix(in srgb,var(--dn-accent) 70%,#fff);background:color-mix(in srgb,var(--dn-accent) 18%,transparent)}
.dsh-nudge-annotation-note{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#1a1a1a);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsh-nudge-annotation-remove{flex:0 0 auto;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font-size:14px;line-height:1;cursor:pointer}
.dsh-nudge-annotation-remove:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-annotation-open{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;padding:0;border:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.dsh-nudge-annotation-open .dsh-nudge-annotation-quote{-webkit-line-clamp:1}
.dsh-nudge-annotation-open .dsh-nudge-annotation-note{-webkit-line-clamp:1}
.dsh-nudge-annotation-open:hover .dsh-nudge-annotation-quote{color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-module{display:flex;flex-direction:column;gap:8px}
.dsh-nudge-module-head{display:flex;align-items:center;gap:7px;padding:1px 0 8px;border:0;border-bottom:1px solid var(--dn-line);background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12.5px;font-weight:700;letter-spacing:.2px;text-align:left;user-select:none}
.dsh-nudge-module-head::before{content:'';flex:0 0 auto;width:3px;height:13px;border-radius:2px;background:var(--dn-accent);margin-left:2px}
.dsh-nudge-module-title{white-space:nowrap}
.dsh-nudge-module-main{display:inline-flex;align-items:center;gap:6px;min-width:0;padding:2px 4px;margin-left:-4px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer;transition:color .15s ease,background .15s ease}
.dsh-nudge-module-main:hover{color:var(--dn-accent);background:var(--dn-hover)}
.dsh-nudge-module-main:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-module-actions{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto}
.dsh-nudge-head-btn,.dsh-nudge-head-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;height:22px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66);font:inherit;font-size:11.5px;font-weight:600;letter-spacing:0;line-height:1;white-space:nowrap;cursor:pointer;transition:background .15s ease,color .15s ease}
.dsh-nudge-head-icon{width:22px;padding:0}
.dsh-nudge-head-btn:hover,.dsh-nudge-head-icon:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-head-btn:focus-visible,.dsh-nudge-head-icon:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-head-btn.active,.dsh-nudge-head-icon.active{background:var(--dn-accent-soft);color:var(--dn-accent)}
.dsh-nudge-head-btn.inactive,.dsh-nudge-head-btn:disabled{opacity:.45;cursor:default;background:transparent;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-module-body{display:flex;flex-direction:column;gap:10px;padding-top:2px}
.dsh-nudge-icon.active{background:var(--dn-accent-soft);color:var(--dn-accent)}
@keyframes dsh-nudge-attention{0%{box-shadow:inset 0 0 0 0 var(--dn-accent-line);opacity:0}20%{box-shadow:inset 0 0 0 3px var(--dn-accent-soft);opacity:1}100%{box-shadow:inset 0 0 0 0 transparent;opacity:0}}
.dsh-nudge-attention-ring{position:absolute;inset:0;border-radius:inherit;pointer-events:none;animation:dsh-nudge-attention .9s ease-out}
::highlight(dsh-nudge-notes){background:#fde68a;color:#1f2937}
/* A passage marked as the answer keeps the note's own purple, on a light tint
   so the text under it stays readable in the light theme. */
::highlight(dsh-nudge-answers){background:var(--dsh-nudge-answer-bg,#ddd6fe);color:var(--dsh-nudge-answer-fg,#1f2937)}
/* Same colours as the browser's own selection on Chromium/Windows, because
   focusing the note field collapses the real selection before it can be kept.
   --dsh-nudge-capture-bg / -fg stay overridable for other platforms/themes. */
::highlight(dsh-nudge-capture){background:var(--dsh-nudge-capture-bg,#3367d1);color:var(--dsh-nudge-capture-fg,#fff)}
.dsh-nudge-pill{position:fixed;z-index:${Z_INDEX};display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border-radius:50%;border:var(--dn-frame) solid var(--dn-accent-edge);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);box-shadow:0 1px 2px rgba(15,23,42,.04),0 10px 26px -14px rgba(15,23,42,.3);font:600 12px/1 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;cursor:grab;pointer-events:auto;touch-action:none;user-select:none;transition:transform .15s ease,box-shadow .15s ease;animation:dsh-nudge-in .18s ease-out}
.dsh-nudge-pill:active{cursor:grabbing}
.dsh-nudge-pill:hover{transform:translateY(-1px);box-shadow:0 1px 2px rgba(15,23,42,.04),0 14px 30px -14px rgba(15,23,42,.35)}
.dsh-nudge-pill:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px}
.dsh-nudge-unread{position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--dn-accent);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-settings{display:flex;flex-direction:column;gap:14px;font:inherit;color:var(--dsw-alias-label-primary,#1a1a1a)}
/* The shell Settings panel caps the body at 800px and scrolls it. While this
   section is mounted, let the panel grow with the section instead (never
   smaller than the shell's own height, never taller than the viewport); the
   shell's internal options area still scrolls once that cap is reached. The
   :has() scope is what keeps the override from affecting other sections. */
body:has(.dsh-nudge-settings) [data-shortcut-modal="settings"]{height:auto;min-height:min(800px,calc(100vh - 2 * max(24px,var(--dsh-frame-overlay-top,24px))));max-height:calc(100vh - 2 * max(24px,var(--dsh-frame-overlay-top,24px)))}
.dsh-nudge-settings-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-settings-section{display:flex;flex-direction:column;gap:8px}
.dsh-nudge-settings-section-head{display:flex;align-items:center;gap:7px;padding:0 2px 7px;border-bottom:1px solid var(--dn-line)}
.dsh-nudge-settings-section-head::before{content:'';flex:0 0 auto;width:3px;height:13px;border-radius:2px;background:var(--dn-accent);margin-left:2px}
.dsh-nudge-settings-section-title{font-size:12.5px;font-weight:700;letter-spacing:.2px;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-settings-section-desc{margin:-2px 2px 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-settings-section-meta{margin-left:auto;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head{cursor:pointer;user-select:none;list-style:none}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head::-webkit-details-marker{display:none}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head::after{content:'';flex:0 0 auto;width:6px;height:6px;margin-left:6px;border-right:1.5px solid var(--dsw-alias-label-secondary,#8a8a8a);border-bottom:1.5px solid var(--dsw-alias-label-secondary,#8a8a8a);opacity:.7;transform:rotate(45deg);transition:transform .15s ease}
.dsh-nudge-settings-section.collapsible:not([open]) .dsh-nudge-settings-section-head::after{transform:rotate(-45deg)}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head:hover,.dsh-nudge-settings-fold-head:hover{background:var(--dn-hover);border-radius:6px}
.dsh-nudge-settings-section.collapsible .dsh-nudge-settings-section-head:focus-visible,.dsh-nudge-settings-fold-head:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:2px;border-radius:6px}
.dsh-nudge-settings-section.collapsible[open] .dsh-nudge-settings-section-desc{margin-top:2px}
.dsh-nudge-settings-fold{display:flex;flex-direction:column;gap:8px;padding-top:2px;border-top:1px solid var(--dn-line)}
.dsh-nudge-settings-fold-head{display:flex;align-items:center;gap:8px;padding:5px 2px;cursor:pointer;list-style:none;font-size:11.5px;font-weight:600;letter-spacing:.2px;color:var(--dsw-alias-label-secondary,#6a6a76);user-select:none}
.dsh-nudge-settings-fold-head::-webkit-details-marker{display:none}
.dsh-nudge-settings-fold-head::after{content:'';flex:0 0 auto;width:6px;height:6px;margin-left:6px;border-right:1.5px solid var(--dsw-alias-label-secondary,#8a8a8a);border-bottom:1.5px solid var(--dsw-alias-label-secondary,#8a8a8a);opacity:.7;transform:rotate(45deg);transition:transform .15s ease}
.dsh-nudge-settings-fold:not([open]) .dsh-nudge-settings-fold-head::after{transform:rotate(-45deg)}
.dsh-nudge-settings-fold-meta{margin-left:auto;font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
.dsh-nudge-settings-note{font-size:12px;line-height:1.6;color:var(--dn-accent-line,var(--dsw-alias-label-secondary,#5a5a66))}
.dsh-nudge-toggle{display:flex;align-items:flex-start;gap:10px;padding:12px;border-radius:12px;border:1px solid var(--dn-line);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 3%,transparent);cursor:pointer}
.dsh-nudge-toggle input{accent-color:var(--dn-accent);margin:2px 0 0;flex:0 0 auto;width:14px;height:14px}
.dsh-nudge-toggle-text{display:flex;flex-direction:column;gap:3px;min-width:0}
.dsh-nudge-toggle-title{font-size:12px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-toggle-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#5a5a66)}
.dsh-nudge-preset-row{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;border:1px solid var(--dn-line);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 3%,transparent)}
.dsh-nudge-preset-line{display:flex;align-items:center;gap:8px}
.dsh-nudge-preset-row input{flex:1 1 auto;min-width:0;height:32px;box-sizing:border-box;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;padding:0 10px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-nudge-preset-row textarea{width:100%;box-sizing:border-box;min-height:56px;field-sizing:content;max-height:min(320px,40vh);overflow-y:auto;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1.55;padding:8px 10px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-nudge-preset-row input:focus,.dsh-nudge-preset-row textarea:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-preset-actions{display:flex;flex-wrap:wrap;gap:8px}
/* Preset rows are a table of contents: one name per line, bodies on demand. */
.dsh-nudge-preset-row:has(> .dsh-nudge-preset-summary){gap:4px;padding:6px 8px}
.dsh-nudge-preset-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.dsh-nudge-stats-head{display:flex;align-items:center;gap:8px}
.dsh-nudge-stats-today{display:flex;flex-direction:column;gap:5px}
.dsh-nudge-stats-today-head{display:flex;align-items:baseline;gap:6px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-stats-today-label{font-weight:600}
.dsh-nudge-stats-today-date{font-variant-numeric:tabular-nums}
.dsh-nudge-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.dsh-nudge-stat{display:flex;flex-direction:column;gap:1px;min-width:0;padding-left:12px;border-left:1px solid var(--dn-line)}
.dsh-nudge-stat:first-child{padding-left:0;border-left:0}
.dsh-nudge-stat-value{font-size:22px;line-height:1.15;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-stat-label{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a)}
/* One board: trend on the left, prompt ranking on the right. Narrow panels
   (the in-window fallback) stack the two instead of squeezing the chart. */
.dsh-nudge-stats-board{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin-top:2px;padding-top:12px;border-top:1px solid var(--dn-line)}
.dsh-nudge-stats-chart-pane{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-nudge-stats-trend-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-stats-total{font-variant-numeric:tabular-nums}
.dsh-nudge-chart-peak{color:var(--dsw-alias-label-secondary,#9a9aa4)}
.dsh-nudge-chart-wrap{position:relative;flex:0 0 auto;width:100%;aspect-ratio:320/168;min-height:150px;overflow:visible}
.dsh-nudge-chart-svg{display:block;width:100%;height:100%;overflow:visible}
.dsh-nudge-chart-grid{stroke:var(--dn-line);stroke-width:1;stroke-dasharray:2 4;opacity:.7}
.dsh-nudge-chart-axis-line{stroke:var(--dn-line);stroke-width:1}
.dsh-nudge-chart-point{stroke:var(--dsw-alias-bg-layer-1,#fff);stroke-width:1.2}
.dsh-nudge-chart-point.input{fill:var(--dsw-static-deepseek-450,#5686fe)}
.dsh-nudge-chart-point.note{fill:var(--dn-note)}
.dsh-nudge-chart-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 12px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a8a8a);text-align:center}
.dsh-nudge-chart-hits{position:absolute;inset:0;display:flex}
.dsh-nudge-chart-hit{flex:1 1 0;position:relative;min-width:0}
.dsh-nudge-chart-tip{position:absolute;top:2px;left:50%;transform:translateX(-50%);z-index:2;display:flex;flex-direction:column;gap:1px;padding:5px 8px;border-radius:8px;border:1px solid var(--dn-line);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 22px -12px rgba(15,23,42,.45);font-size:11px;line-height:1.4;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s ease}
.dsh-nudge-chart-hit:hover .dsh-nudge-chart-tip{opacity:1}
.dsh-nudge-chart-hit:nth-child(-n+3) .dsh-nudge-chart-tip{left:0;transform:none}
.dsh-nudge-chart-hit:nth-last-child(-n+3) .dsh-nudge-chart-tip{left:auto;right:0;transform:none}
.dsh-nudge-chart-tip-date{font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);font-variant-numeric:tabular-nums}
.dsh-nudge-chart-tip-values{color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-stats-axis{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
.dsh-nudge-chart-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-chart-legend-item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dsh-nudge-chart-dot{flex:0 0 auto;width:11px;height:3px;border-radius:2px}
.dsh-nudge-chart-dot.input{background:var(--dsw-static-deepseek-450,#5686fe)}
.dsh-nudge-chart-dot.note{background:var(--dn-note)}
.dsh-nudge-stats-side{display:flex;flex-direction:column;gap:6px;min-width:0}
/* Today sits above the ranking and stays compact: the board is a summary, not
   a second settings page. */
.dsh-nudge-stats-side .dsh-nudge-stats-today{gap:4px;padding-bottom:8px;border-bottom:1px solid var(--dn-line)}
.dsh-nudge-stats-side .dsh-nudge-stats-today-head{justify-content:space-between}
.dsh-nudge-stats-side .dsh-nudge-stats{gap:6px}
.dsh-nudge-stats-side .dsh-nudge-stat{padding-left:7px}
.dsh-nudge-stats-side .dsh-nudge-stat:first-child{padding-left:0}
.dsh-nudge-stats-side .dsh-nudge-stat-value{font-size:18px;line-height:1.1}
.dsh-nudge-stats-side .dsh-nudge-stat-label{font-size:10px;line-height:1.3}
.dsh-nudge-stats-side-head{margin-top:1px}
.dsh-nudge-stats-side-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-stats-side-empty{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-top-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.dsh-nudge-top-item{display:flex;align-items:center;gap:8px;min-width:0;padding:3px 6px;border-radius:8px;transition:background .15s ease}
.dsh-nudge-top-item:hover{background:var(--dn-hover)}
.dsh-nudge-top-rank{flex:0 0 18px;height:18px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 6%,transparent);color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:10.5px;font-weight:600;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.dsh-nudge-top-item:first-child .dsh-nudge-top-rank{background:var(--dn-accent-soft);color:var(--dn-accent)}
.dsh-nudge-top-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-top-count{flex:0 0 auto;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-nudge-stats-share{margin-top:auto;padding:4px 6px 0;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a8a8a)}
@container dsh-nudge-stats (min-width: 430px){
  .dsh-nudge-stats-board{grid-template-columns:minmax(0,1.55fr) minmax(150px,1fr);gap:18px}
  .dsh-nudge-stats-side{padding-left:18px;border-left:1px solid var(--dn-line)}
}
.dsh-nudge-preset-count{margin-right:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#8a8a8a);font-variant-numeric:tabular-nums}
.dsh-nudge-preset-summary{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-nudge-preset-grip{cursor:grab;padding:2px;border-radius:6px;color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:13px;line-height:1;user-select:none}
.dsh-nudge-preset-grip:active{cursor:grabbing}
.dsh-nudge-preset-grip:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-preset-toggle{flex:0 1 auto;min-width:0;margin-right:auto;display:flex;align-items:center;gap:6px;padding:4px 6px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.dsh-nudge-preset-toggle:hover{background:var(--dn-hover)}
.dsh-nudge-preset-toggle:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-preset-toggle svg{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-preset-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#1a1a1a);font-weight:600}
.dsh-nudge-tip-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#1a1a1a);font-size:12px;line-height:1.6}
.dsh-nudge-preset-tools{display:flex;align-items:center;gap:4px;flex:0 0 auto}
/* Drag: the summary is the handle, and the row follows the pointer live. */
.dsh-nudge-preset-summary{cursor:grab}
.dsh-nudge-preset-summary:active{cursor:grabbing}
.dsh-nudge-preset-row.dragging{opacity:.65;border-color:var(--dn-accent-line);box-shadow:0 6px 18px rgba(0,0,0,.08)}
.dsh-nudge-preset-row.disabled{opacity:.72}
.dsh-nudge-preset-row.disabled .dsh-nudge-preset-name{color:var(--dsw-alias-label-secondary,#8a8a8a);font-weight:500}
/* Two places one prompt can live: the window's prompt row and the row under
   the input box. Same pill, same height; filled means "shown there". */
.dsh-nudge-preset-place{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--dn-line);background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a);font:inherit;font-size:11.5px;line-height:1;white-space:nowrap;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease}
.dsh-nudge-preset-place:hover{background:var(--dn-hover)}
.dsh-nudge-preset-place.on{background:var(--dn-accent-soft);border-color:var(--dn-accent-line);color:var(--dn-accent)}
.dsh-nudge-preset-place:focus-visible{outline:2px solid var(--dn-accent-line);outline-offset:1px}
.dsh-nudge-place-short{display:none}
@container (max-width:520px){.dsh-nudge-place-long{display:none}.dsh-nudge-place-short{display:inline}}
.dsh-nudge-preset-row[data-preset-id]{gap:4px;padding:7px 9px;border:0;border-radius:0;background:transparent;container-type:inline-size}
.dsh-nudge-preset-row[data-preset-id] + .dsh-nudge-preset-row[data-preset-id]{border-top:1px solid var(--dn-line)}
.dsh-nudge-preset-row[data-preset-id] .dsh-nudge-preset-tools .dsh-nudge-btn.icon{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a)}
.dsh-nudge-preset-row[data-preset-id] .dsh-nudge-preset-tools .dsh-nudge-btn.icon:hover{background:var(--dn-hover);color:var(--dsw-alias-label-primary,#1a1a1a)}
.dsh-nudge-preset-row[data-preset-id] .dsh-nudge-preset-tools .dsh-nudge-btn.icon.danger{color:var(--dsw-alias-state-error-primary,#c8433c)}
.dsh-nudge-preset-body{margin:0 6px 2px 30px;padding:8px 10px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 4%,transparent);color:var(--dsw-alias-label-secondary,#555);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:min(280px,36vh);overflow-y:auto}
.dsh-nudge-preset-text{white-space:pre-wrap;word-break:break-word}
.dsh-nudge-preset-editor{display:flex;flex-direction:column;gap:8px;padding:2px 6px 2px 30px}
.dsh-nudge-preset-editor input{flex:0 0 auto}
.dsh-nudge-preset-empty{padding:14px;border:1px dashed var(--dn-line);border-radius:12px;color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:12px;line-height:1.6;text-align:center}
.dsh-nudge-preset-import{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px dashed var(--dn-accent-line);border-radius:12px}
.dsh-nudge-preset-import textarea{width:100%;box-sizing:border-box;min-height:96px;max-height:min(320px,40vh);overflow-y:auto;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1.55;padding:8px 10px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-nudge-preset-import textarea:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-tip-draft{display:flex;flex-direction:column;gap:8px}
.dsh-nudge-tip-draft textarea{width:100%;box-sizing:border-box;min-height:64px;max-height:min(240px,32vh);overflow-y:auto;border:1px solid var(--dn-line);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;line-height:1.55;padding:8px 10px;transition:border-color .15s ease,box-shadow .15s ease}
.dsh-nudge-tip-draft textarea:focus{outline:none;border-color:var(--dn-accent-line);box-shadow:0 0 0 3px var(--dn-accent-soft)}
.dsh-nudge-tip-draft .dsh-nudge-btn{align-self:flex-start}
.dsh-nudge-btn{height:30px;padding:0 12px;border:1px solid var(--dn-line);border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:12px;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease}
.dsh-nudge-btn:hover{background:var(--dn-hover)}
.dsh-nudge-btn.primary{background:var(--dn-accent);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600}
.dsh-nudge-btn.primary:hover{filter:brightness(1.05);background:var(--dn-accent)}
.dsh-nudge-btn.danger{color:var(--dsw-alias-state-error-primary,#c8433c);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 28%,transparent)}
.dsh-nudge-btn.danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c8433c) 10%,transparent)}
.dsh-nudge-btn.icon{width:30px;padding:0;font-size:13px;line-height:1}
.dsh-nudge-btn:disabled{opacity:.4;cursor:default}
.dsh-nudge-btn:disabled:hover{background:transparent}
.dsh-nudge-settings-group,.dsh-nudge-stats-group{display:flex;flex-direction:column;gap:7px;padding:12px;border-radius:12px;border:1px solid var(--dn-line);background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 3%,transparent)}
/* A setting that is one control wide enough to sit on a single row: label on
   the left, its choices on the right, no separate description line. */
.dsh-nudge-settings-inline{flex-direction:row;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px}
.dsh-nudge-settings-inline .dsh-nudge-toggle-title{flex:0 0 auto}
.dsh-nudge-settings-inline .dsh-nudge-presets{flex-wrap:nowrap}
/* The stats board is the page's hero: slightly raised, and a container so the
   chart/ranking split only kicks in when the panel is actually wide enough. */
.dsh-nudge-stats-group{container-type:inline-size;container-name:dsh-nudge-stats;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px rgba(15,23,42,.04)}
.dsh-nudge-settings-error{color:var(--dsw-alias-state-error-primary,#c8433c);font-size:12px;line-height:1.5}
.dsh-nudge-tip{position:fixed;z-index:${Z_INDEX + 2};box-sizing:border-box;padding:7px 10px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#1a1a1a) 92%,#000);color:#fff;font:12px/1.45 ui-sans-serif,system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 10px 26px -8px rgba(15,23,42,.45);pointer-events:none;animation:dsh-nudge-tip-in .12s ease-out}
@keyframes dsh-nudge-tip-in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
.dsh-nudge-tip-head{display:flex;align-items:baseline;gap:6px;white-space:nowrap}
.dsh-nudge-tip-title{font-weight:600}
.dsh-nudge-tip-state{color:color-mix(in srgb,var(--dn-accent) 55%,#fff);font-weight:600}
.dsh-nudge-tip-hint{margin-top:2px;font-size:11px;line-height:1.5;opacity:.78}
@media (prefers-reduced-motion:reduce){.dsh-nudge-tip{animation:none}}
`.trim()

export { OFFICIAL_SELECTION_CSS, viewCss, CSS }
