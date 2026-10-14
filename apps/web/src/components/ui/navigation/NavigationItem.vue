<script lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { PropType, VNode } from 'vue'
import type { NavigationVariant } from './context'
import { Primitive, useForwardExpose } from 'reka-ui'
import { cloneVNode, Comment, computed, defineComponent, Fragment, h, inject, mergeProps } from 'vue'
import { navigationVariantKey } from './context'

export default defineComponent({
  name: 'NavigationItem',
  inheritAttrs: false,
  props: {
    as: { type: [String, Object, Function] as PropType<PrimitiveProps['as']>, default: 'button' },
    asChild: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    variant: { type: String as PropType<NavigationVariant>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const inheritedVariant = inject(navigationVariantKey, undefined)
    const variant = computed(() => props.variant ?? inheritedVariant?.value ?? 'segmented')
    const { forwardRef, currentElement } = useForwardExpose()
    const isButton = computed(() => currentElement.value?.tagName === 'BUTTON' || (!props.asChild && props.as === 'button'))

    function preventDisabledActivation(event: MouseEvent | KeyboardEvent): void {
      if (!props.disabled || (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)))
        return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    function disabledChildren(children: VNode[]): VNode[] {
      return children.map((child) => {
        if (child.type === Comment)
          return child
        if (child.type === Fragment) {
          const fragment = cloneVNode(child)
          fragment.children = disabledChildren(child.children as VNode[])
          return fragment
        }
        // Primitive's asChild merge lets child props win. Disabled state is the
        // exception: clone fresh slot VNodes so enabling restores their own attrs.
        const disabledAttrs: Record<string, unknown> = {
          'aria-disabled': true,
          'data-disabled': '',
          'tabindex': -1,
        }
        if (child.type === 'button' || isButton.value)
          disabledAttrs.disabled = true
        return cloneVNode(child, disabledAttrs)
      })
    }

    return () => h(Primitive, mergeProps({
      onClickCapture: preventDisabledActivation,
      onMousedownCapture: preventDisabledActivation,
      onKeydownCapture: preventDisabledActivation,
    }, attrs, {
      'ref': forwardRef,
      'as': props.as,
      'asChild': props.asChild,
      'class': 'ui-navigation-item',
      'data-slot': attrs['data-slot'] ?? 'navigation-item',
      'data-variant': variant.value,
      'type': attrs.type ?? (!props.asChild && props.as === 'button' ? 'button' : undefined),
      'disabled': props.disabled && isButton.value ? true : attrs.disabled,
      'aria-disabled': props.disabled ? true : attrs['aria-disabled'],
      'data-disabled': props.disabled ? '' : attrs['data-disabled'],
      'tabindex': props.disabled ? -1 : attrs.tabindex,
    }), {
      default: () => {
        const children = slots.default?.() ?? []
        if (props.asChild)
          return props.disabled ? disabledChildren(children) : children
        return [
          slots.icon ? h('span', { 'data-slot': 'navigation-icon', 'aria-hidden': true }, slots.icon()) : null,
          ...children,
        ]
      },
    })
  },
})
</script>

<style>
.ui-navigation-item {
  box-sizing: border-box;
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: var(--navigation-icon-gap);
  border: 0;
  border-radius: var(--navigation-item-radius);
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--navigation-font-size);
  font-weight: var(--workbench-sidebar-font-weight);
  line-height: var(--navigation-line-height);
  text-align: left;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.ui-navigation-item[data-variant='segmented'] {
  min-height: var(--navigation-segmented-item-height);
  flex: 0 0 auto;
  padding: 0 var(--navigation-segmented-item-padding-inline);
  /* Keep text metrics stable as the selected segment changes. */
  font-weight: var(--workbench-sidebar-active-weight);
}

.ui-navigation-item[data-variant='sidebar'] {
  width: 100%;
  min-height: var(--navigation-sidebar-item-height);
  justify-content: flex-start;
  padding: 0 var(--navigation-sidebar-item-padding-inline);
  color: var(--workbench-sidebar-color);
}

.ui-navigation-item:hover:not(:disabled, [data-disabled]) {
  background: var(--surface-hover);
  color: var(--text);
}

.ui-navigation-item[data-variant='segmented']:is([data-state='active'], [aria-selected='true'], [aria-current='page'], .active) {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 2px var(--shadow);
}

.ui-navigation-item[data-variant='sidebar']:is([data-state='active'], [aria-selected='true'], [aria-current='page'], .active) {
  background: var(--workbench-sidebar-active-background);
  color: var(--workbench-sidebar-active-color);
  font-weight: var(--workbench-sidebar-active-weight);
}

.ui-navigation-item:focus-visible {
  outline: var(--control-focus-width) solid var(--focus-ring);
  outline-offset: var(--control-focus-offset);
}

.ui-navigation-item[data-variant='segmented']:focus-visible {
  outline-offset: calc(-1 * var(--control-focus-width));
}

.ui-navigation-item:is(:disabled, [data-disabled]) {
  opacity: var(--control-disabled-opacity);
  cursor: default;
}

.ui-navigation-item :is(.app-icon, .visual-icon, [data-slot='navigation-icon']) {
  display: inline-flex;
  width: var(--navigation-icon-size);
  height: var(--navigation-icon-size);
  flex: 0 0 var(--navigation-icon-size);
  align-items: center;
  justify-content: center;
  color: currentColor;
}

.ui-navigation-item [data-slot='navigation-icon'] > * {
  width: 100%;
  height: 100%;
}

.ui-navigation-item[data-variant='sidebar'] .visual-icon img {
  filter: grayscale(1);
  opacity: .65;
}

.ui-navigation-item[data-variant='sidebar']:is(:hover, :focus-visible) .visual-icon img {
  opacity: 1;
}

.ui-navigation-item[data-variant='sidebar']:is([data-state='active'], [aria-selected='true'], [aria-current='page'], .active) .visual-icon img {
  filter: none;
  opacity: 1;
}

.ui-navigation-item small {
  display: inline-grid;
  min-width: var(--navigation-badge-size);
  height: var(--navigation-badge-size);
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}

.ui-navigation-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
