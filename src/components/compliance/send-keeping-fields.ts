// A form that keeps what is in its boxes when the server refuses a save.
//
// React resets a form once its <form action> has run, refused or not. On the
// ESP reasoning card (a4c) that wiped the agent's reasoning, or RealComply's
// draft, from the box whenever a save was refused, while the draft's own
// controls stayed on screen. Live, 14 Oct 2026 (Adam): the agent drafted the
// reasoning, pressed Done without editing it, the old edit-first rule refused
// the save, the box emptied, and the card was stuck until they pressed
// Discard. Found on the preview too (13 Oct 2026).
//
// Such a form is sent from onSubmit instead of <form action>: the browser's
// own submit is stopped, and the form's values go to the action inside a
// transition, with the button pressed (it carries the status). React has no
// form action to reset, so a refused save leaves every box as it was.

/** Cards whose form keeps its values when the server refuses a save. */
export function keepsFieldsOnRefusal(itemKey: string): boolean {
  return itemKey === "a4c";
}

/** The parts of a React submit event this uses. */
export type SubmitLike = {
  preventDefault: () => void;
  currentTarget: HTMLFormElement;
  nativeEvent: Event;
};

export function sendKeepingFields(
  event: SubmitLike,
  send: (formData: FormData) => void,
  startTransition: (scope: () => void) => void,
  formDataOf: (form: HTMLFormElement, submitter: HTMLElement | null) => FormData = (form, submitter) =>
    new FormData(form, submitter),
): void {
  event.preventDefault();
  const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
  const formData = formDataOf(event.currentTarget, submitter);
  startTransition(() => send(formData));
}
