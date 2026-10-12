import type { ComputedRef, InjectionKey } from 'vue'

export type NavigationVariant = 'segmented' | 'sidebar'

export const navigationVariantKey: InjectionKey<ComputedRef<NavigationVariant>> = Symbol('navigation-variant')
