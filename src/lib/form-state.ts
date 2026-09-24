/**
 * What a popup form's server action reports back to FormDialog.
 *
 * `error` keeps the dialog open with the message shown; `ok` changes on every
 * success (it is a timestamp), which is what tells the dialog to close.
 */
export type FormState = { error?: string; ok?: number };
