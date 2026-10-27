import type { ExtensionSelection } from './extension-decoders'
export function copyExtensionSelection(value: ExtensionSelection): ExtensionSelection {
  return {
    skillIds: [...value.skillIds],
    toolIds: [...value.toolIds],
    ...(value.mediaBindings
      ? {
          mediaBindings: {
            ...value.mediaBindings,
            ...(value.mediaBindings.imageReferenceIds
              ? { imageReferenceIds: [...value.mediaBindings.imageReferenceIds] }
              : {}),
          },
        }
      : {}),
  }
}
