// Branding helpers shared across field-value classes and standalone Value /
// ValueSchema. Brands are non-enumerable, non-configurable symbol properties
// used as `value is X` checks without paying for `instanceof` (which doesn't
// work across realms or with class-mixing patterns).

/** Stamp `target` with a brand symbol so {@link hasBrand} can identify it. */
export function applyBrand(target: object, brand: symbol): void {
	Object.defineProperty(target, brand, {
		value: true,
		enumerable: false,
	});
}

/** Check whether `value` carries a given brand symbol. */
export function hasBrand(value: unknown, brand: symbol): boolean {
	return typeof value === 'object' && value !== null && brand in value;
}
