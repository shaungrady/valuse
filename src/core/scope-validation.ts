/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { signal as createSignal, computed, effect } from './signal.js';
import { subscribeFireOnly } from './utils/effect-helpers.js';
import { getReactHooks, versionedAdapter } from './react-bridge.js';
import { walkRefCollect, walkRefTrack, walkRefValid } from './ref-walk.js';
import type { FieldValueSchema } from './field-value.js';
import type { InstanceStore } from './instance-store.js';
import type { ScopeConfig } from './scope-config.js';
import type { ScopeDefinitionMeta } from './slot-meta.js';
import type { ScopeValidationResult } from './scope-types.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/** Set up validation: the `validate` config derivation and `$getIsValid`/`$useIsValid`. @internal */
export function setupValidation(
	instance: Record<string, unknown>,
	store: InstanceStore,
	definition: ScopeDefinitionMeta,
	config: ScopeConfig | undefined,
	derivationScope: Record<string, unknown>,
	cleanups: (() => void)[],
	resolvedRefs: Map<string, unknown>,
): void {
	// Schema slot indices (precomputed once per definition).
	const schemaSlots = definition.schemaSlots;

	const validateFn = config?.validate;
	const hasValidateHook = !!validateFn;
	const hasValidationSources = schemaSlots.length > 0 || hasValidateHook;

	// Set up the validate derivation as a computed signal
	let validateIssuesSignal: ReturnType<typeof createSignal> | null = null;
	if (validateFn) {
		validateIssuesSignal = createSignal<
			{
				readonly message: string;
				readonly path?:
					| ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
					| undefined;
			}[]
		>([]);

		// Run the validate function as a computed derivation
		const derivedValidateSignal = computed(() => {
			try {
				return validateFn({
					scope: derivationScope as Parameters<typeof validateFn>[0]['scope'],
				});
			} catch (error) {
				// A throwing validate hook would otherwise propagate out of
				// the source `.set()` that triggered the recompute, and
				// leave `$getIsValid()` reporting `true` indefinitely (since
				// the issues signal never updated). Contain the throw, log
				// it, and synthesise a scope-level issue so the scope
				// reports invalid until the hook recovers.
				console.error('valuse: validate hook threw', error);
				return [
					{
						message:
							error instanceof Error ?
								`validate threw: ${error.message}`
							:	`validate threw: ${String(error)}`,
					},
				];
			}
		});

		// Sync computed to the signal. Disposed on $destroy.
		const dispose = effect(() => {
			validateIssuesSignal!.value = derivedValidateSignal.value;
		});
		cleanups.push(dispose);
	}

	// Helper to get routed validate issues for a specific field
	function getRoutedIssuesForField(fieldName: string) {
		if (!validateIssuesSignal) return [];
		const allIssues = (
			validateIssuesSignal as {
				peek(): {
					readonly message: string;
					readonly path?:
						| ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
						| undefined;
				}[];
			}
		).peek();
		return allIssues.filter((issue) => {
			if (!issue.path || issue.path.length === 0) return false;
			const firstSegment = issue.path[0];
			const key =
				typeof firstSegment === 'object' && 'key' in firstSegment ?
					firstSegment.key
				:	firstSegment;
			return key === fieldName;
		});
	}

	// Patch schema field wrappers to include routed validate issues in getValidation
	if (hasValidateHook) {
		for (const slot of schemaSlots) {
			const meta = definition.slots[slot]!;
			const wrapper = instance[meta.fieldName] as FieldValueSchema<
				unknown,
				unknown
			>;

			const originalGetValidation = wrapper.getValidation.bind(wrapper);
			const slotIndex = slot;
			wrapper.getValidation = () => {
				const baseValidation = originalGetValidation();
				const routedIssues = getRoutedIssuesForField(meta.fieldName);
				if (routedIssues.length === 0) return baseValidation;

				// Merge issues. The `ValidationState<In, Out>` union flips on
				// `isValid`: `value` is `Out` (parsed) when valid, `In` (raw
				// input) when invalid. If routed issues flip a previously
				// valid result to invalid, swap the parsed `Out` back to the
				// raw `In` so the discriminated union holds. This only
				// matters for schemas that morph types (e.g. arktype
				// `string.numeric.parse`); for pure validators where In==Out
				// it's a no-op.
				const allIssues = [...baseValidation.issues, ...routedIssues];
				const value =
					baseValidation.isValid ? store.read(slotIndex) : baseValidation.value;
				return {
					isValid: false,
					value,
					issues: allIssues,
				};
			};

			// `useValidation` on the field wrapper used to only subscribe to
			// the field's own value signal and its own schema-validation
			// state. When a cross-field `validate` hook routed an issue here
			// via `path: ['<fieldName>']`, neither of those signals fired —
			// only `validateIssuesSignal` did — so the React hook never
			// re-rendered even though `getValidation()` would return updated
			// merged issues if you read it manually. Patch the hook so it
			// also subscribes to `validateIssuesSignal`.
			const slotForHook = slot;
			const originalUseValidation = wrapper.useValidation.bind(wrapper);
			wrapper.useValidation = () => {
				const hooks = getReactHooks();
				if (hooks && validateIssuesSignal) {
					const adapter = versionedAdapter(wrapper, (onChange) => {
						const unsub1 = wrapper.subscribe(() => {
							onChange();
						});
						const unsub2 = store.subscribeValidation(slotForHook, () => {
							onChange();
						});
						const unsub3 = subscribeFireOnly(() => {
							void (validateIssuesSignal as { value: unknown }).value;
						}, onChange);
						return () => {
							unsub1();
							unsub2();
							unsub3();
						};
					});
					hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
					return [
						wrapper.get(),
						(valueOrFn: unknown) => {
							wrapper.set(valueOrFn);
						},
						wrapper.getValidation(),
					] as ReturnType<typeof originalUseValidation>;
				}
				return originalUseValidation();
			};
		}
	}

	// Shared helpers used by shallow + deep checks
	function checkOwnValid(): boolean {
		for (const slot of schemaSlots) {
			const validation = store.readValidation(slot);
			if (!validation.isValid) return false;
		}
		if (validateIssuesSignal) {
			const issues = (
				validateIssuesSignal as {
					peek(): { readonly message: string }[];
				}
			).peek();
			if (issues.length > 0) return false;
		}
		return true;
	}

	// Deep walk: call each subscope's internal _deepCheckValid if present.
	function deepCheckValid(visited: WeakSet<object>): boolean {
		if (visited.has(instance)) return true;
		visited.add(instance);
		if (hasValidationSources && !checkOwnValid()) return false;
		for (const ref of resolvedRefs.values()) {
			if (!walkRefValid(ref, visited)) return false;
		}
		return true;
	}

	// Deep reactive track: touches every .value in the tree so an enclosing
	// effect re-runs when any relevant signal changes (including ScopeMap
	// membership and subscope validation).
	function trackDeepValid(visited: WeakSet<object>): void {
		if (visited.has(instance)) return;
		visited.add(instance);
		for (const slot of schemaSlots) {
			const sig = store.validationStates?.get(slot);
			if (sig) void sig.value;
		}
		if (validateIssuesSignal) {
			void (validateIssuesSignal as { value: unknown }).value;
		}
		for (const ref of resolvedRefs.values()) {
			walkRefTrack(ref, visited);
		}
	}

	// Issue collectors mirror the boolean checks above but build a flat
	// `StandardSchemaV1.Issue[]` with scope-relative paths. Field issues are
	// prefixed with the field name; validate-hook issues pass through with
	// the author-supplied path.
	function collectOwnIssues(): StandardSchemaV1.Issue[] {
		const issues: StandardSchemaV1.Issue[] = [];
		for (const slot of schemaSlots) {
			const meta = definition.slots[slot]!;
			const validation = store.readValidation(slot);
			if (!validation.isValid) {
				for (const issue of validation.issues) {
					issues.push({
						message: issue.message,
						path: [meta.fieldName, ...(issue.path ?? [])],
					});
				}
			}
		}
		if (validateIssuesSignal) {
			const hookIssues = (
				validateIssuesSignal as {
					peek(): StandardSchemaV1.Issue[];
				}
			).peek();
			for (const issue of hookIssues) issues.push(issue);
		}
		return issues;
	}

	function deepCollectIssues(
		visited: WeakSet<object>,
	): StandardSchemaV1.Issue[] {
		if (visited.has(instance)) return [];
		visited.add(instance);
		const issues = hasValidationSources ? collectOwnIssues() : [];
		for (const [refKey, ref] of resolvedRefs) {
			const refIssues = walkRefCollect(ref, visited);
			for (const issue of refIssues) {
				issues.push({
					message: issue.message,
					path: [refKey, ...(issue.path ?? [])],
				});
			}
		}
		return issues;
	}

	// Subscription factory shared by `$useIsValid` and `$useValidation`. Both
	// hooks need to re-render on the same signal set (own schema slots +
	// validate-hook issues, or a deep walk via `_trackDeepValid`); only their
	// final return value differs.
	function subscribeValidationChanges(
		deep: boolean | undefined,
	): (onChange: () => void) => () => void {
		return (onChange) => {
			if (deep) {
				return subscribeFireOnly(() => {
					trackDeepValid(new WeakSet());
				}, onChange);
			}
			const unsubs: (() => void)[] = [];
			for (const slot of schemaSlots) {
				unsubs.push(store.subscribeValidation(slot, onChange));
			}
			if (validateIssuesSignal) {
				unsubs.push(
					subscribeFireOnly(() => {
						void (validateIssuesSignal as { value: unknown }).value;
					}, onChange),
				);
			}
			return () => {
				for (const unsub of unsubs) unsub();
			};
		};
	}

	// Expose the internal walkers so parent scopes can recurse into this one.
	instance._deepCheckValid = deepCheckValid;
	instance._trackDeepValid = trackDeepValid;
	instance._deepCollectIssues = deepCollectIssues;

	instance.$getIsValid = (options?: { deep?: boolean }) => {
		if (options?.deep) {
			return deepCheckValid(new WeakSet());
		}
		if (!hasValidationSources) {
			throw new Error(
				'$getIsValid() requires at least one valueSchema field or an validate hook.',
			);
		}
		return checkOwnValid();
	};

	instance.$useIsValid = (options?: { deep?: boolean }) => {
		if (!options?.deep && !hasValidationSources) {
			throw new Error(
				'$useIsValid() requires at least one valueSchema field or an validate hook.',
			);
		}
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(
				instance,
				subscribeValidationChanges(options?.deep),
			);
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return (instance.$getIsValid as (options?: { deep?: boolean }) => boolean)(
			options,
		);
	};

	instance.$getValidation = (options?: { deep?: boolean }) => {
		if (options?.deep) {
			const issues = deepCollectIssues(new WeakSet());
			return { isValid: issues.length === 0, issues };
		}
		if (!hasValidationSources) {
			throw new Error(
				'$getValidation() requires at least one valueSchema field or an validate hook.',
			);
		}
		const issues = collectOwnIssues();
		return { isValid: issues.length === 0, issues };
	};

	instance.$useValidation = (options?: { deep?: boolean }) => {
		if (!options?.deep && !hasValidationSources) {
			throw new Error(
				'$useValidation() requires at least one valueSchema field or an validate hook.',
			);
		}
		const hooks = getReactHooks();
		if (hooks) {
			const adapter = versionedAdapter(
				instance,
				subscribeValidationChanges(options?.deep),
			);
			hooks.useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
		}
		return (
			instance.$getValidation as (options?: {
				deep?: boolean;
			}) => ScopeValidationResult
		)(options);
	};
}
