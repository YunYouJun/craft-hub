# Shared UI components

Form primitives follow [shadcn-vue](https://shadcn-vue.com/docs/components/field)'s source-owned component approach. Input, Textarea, Checkbox and Field were adapted from its `new-york-v4` registry; Select and Dialog compose Reka UI primitives. Registry source can be inspected with `pnpm dlx shadcn-vue@latest view @shadcn/input @shadcn/textarea @shadcn/checkbox @shadcn/field`.

The host uses its existing CSS theme tokens rather than Tailwind classes. Shared form styles live in `src/styles.css`; keep colors, focus, disabled and invalid states there rather than overriding them on individual pages. Icons come from the host's existing icon module.

For detail dialogs with long content, use `DialogShell layout="panel"` with `title`, optional `description` and `header-actions`, default body, and `footer` slots. The shared panel keeps the header and footer visible while the body scrolls within the viewport. Its width, padding and title size use the dialog tokens in `styles/tokens.css`; colors, radius and overlay use the existing theme. Default DialogShell layouts are unchanged. Use FormSelect's `placeholder` for an unselected value rather than an empty option.

Compose `FieldGroup`, `Field`, `FieldLabel` and the control, associating labels with unique control IDs. Pass native attributes to Input and Textarea; use `v-model` for values. Use `data-invalid` on Field and `aria-invalid` on its control when validation reports an error. FormSelect forwards required and disabled state to Reka UI. Provider validation and confirmation remain the responsibility of the consuming form.
