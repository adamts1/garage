import { listLearnedVehicleModels, mergeVehicleCatalog, type VehicleSuggestions } from '@garage/shared';
import { useEffect, useState } from 'react';
import { isConfigured } from './supabase';

const LISTED_ONLY = mergeVehicleCatalog();

/** The make and model suggestions for the intake form: the built-in list,
 *  plus whatever this garage has already saved on its cars. Asked once per
 *  form; until the answer arrives, or if it never does, the built-in list
 *  alone — suggestions are an aid, never a reason to block the form. */
export function useVehicleSuggestions(): VehicleSuggestions {
  const [suggestions, setSuggestions] = useState<VehicleSuggestions>(LISTED_ONLY);
  useEffect(() => {
    if (!isConfigured) return;
    let alive = true;
    listLearnedVehicleModels()
      .then((rows) => { if (alive) setSuggestions(mergeVehicleCatalog(rows)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return suggestions;
}
