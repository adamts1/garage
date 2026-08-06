/* components/ui — the pieces that know how the app looks, and nothing about what
   it is for.

   Nothing in here may import from components/tickets, components/auth, or
   @garage/shared. If a component needs to know what a ticket or a work order is,
   it is a product component and belongs beside the screen that uses it. That one
   rule is what keeps this folder reusable and the domain folders readable.

   The exception, deliberately: these do reach for lib/i18n, because a Sheet has
   a close button and a Stepper has two, and their labels are the same words
   everywhere. */

export { Button, type ButtonSize, type ButtonVariant } from './Button';
export { Checkbox } from './Checkbox';
export { Chip, ChipGroup, ChipRow, type ChipOption } from './Chip';
export { ComboField } from './ComboField';
export { CreateRow } from './CreateRow';
export { Field } from './Field';
export { FormActions } from './FormActions';
export { MenuIcon, PowerIcon, TrashIcon } from './Icons';
export { NumberPrompt } from './NumberPrompt';
export { ReadOnly } from './ReadOnly';
export { SectionHead } from './SectionHead';
export { Sheet } from './Sheet';
export { Stepper } from './Stepper';
export { TotalRow } from './TotalRow';
