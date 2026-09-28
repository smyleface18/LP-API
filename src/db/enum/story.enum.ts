/**
 * Visibilidad de una historieta terminada.
 * - PUBLISHED: aparece en el catálogo y en el historial de sus jugadores.
 * - REMOVED: un admin la quitó (moderación). No se muestra en ningún lado
 *   salvo en el panel de admin; el registro se conserva para auditoría y se
 *   puede restaurar.
 */
export enum StoryVisibility {
  PUBLISHED = 'PUBLISHED',
  REMOVED = 'REMOVED',
}

/** Acción de moderación registrada en `story_moderation_log`. */
export enum StoryModerationAction {
  REMOVED = 'REMOVED',
  RESTORED = 'RESTORED',
}

/** Por qué un admin quitó una historieta. */
export enum StoryRemovalReason {
  /** Contenido no apto para chicos (violencia, contenido sexual, etc.). */
  INAPPROPRIATE_CONTENT = 'INAPPROPRIATE_CONTENT',
  /** Insultos, acoso u odio hacia alguien. */
  OFFENSIVE_LANGUAGE = 'OFFENSIVE_LANGUAGE',
  /** Datos personales (nombres reales, direcciones, teléfonos...). */
  PERSONAL_DATA = 'PERSONAL_DATA',
  /** Texto sin sentido o abuso del sistema (ej. para gastar la IA). */
  SPAM = 'SPAM',
  /** Otro motivo: la nota es obligatoria. */
  OTHER = 'OTHER',
}
