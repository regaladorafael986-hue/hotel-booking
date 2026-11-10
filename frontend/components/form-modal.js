// Modal containing a form: client validation → submit → server errors shown inline.
import { modal, validateForm, formValues, fillForm, showErrors, withLoading, toast } from '/assets/js/ui.js';

/**
 * @param {{ title, fields: string (form inner HTML), values?: object, submitLabel?: string, wide?: boolean,
 *   rules?: object, transform?: (values, form) => object, onSubmit: (payload) => Promise<{message?}>, onOpen?: (form) => void, extraActions?: [] }} o
 */
export function formModal(o) {
  const { el } = modal({
    title: o.title,
    wide: o.wide,
    body: `<form class="form-grid" novalidate>${o.fields}</form>`,
    actions: [
      ...(o.extraActions || []),
      { label: 'Cancel' },
      {
        label: o.submitLabel || 'Save', cls: 'btn',
        onClick: async (close, m, btn) => {
          const form = m.querySelector('form');
          if (!validateForm(form, o.rules || {})) return;
          const payload = o.transform ? o.transform(formValues(form), form) : formValues(form);
          if (!payload) return;
          await withLoading(btn, async () => {
            try {
              const r = await o.onSubmit(payload);
              close();
              if (r?.message) toast(r.message, 'success');
            } catch (err) { showErrors(form, err); }
          });
        },
      },
    ],
  });
  const form = el.querySelector('form');
  if (o.values) fillForm(form, o.values);
  form.addEventListener('submit', (e) => { e.preventDefault(); el.querySelector('.modal-foot .btn:last-child').click(); });
  o.onOpen?.(form);
  return form;
}
