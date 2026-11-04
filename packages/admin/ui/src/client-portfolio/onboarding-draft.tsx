import React,{createContext,useContext,useState,type Dispatch,type SetStateAction} from 'react';
import type {OnboardingTemplate} from '../../../../contracts/src/index.ts';

const DraftContext=createContext<[OnboardingTemplate|null,Dispatch<SetStateAction<OnboardingTemplate|null>>]|null>(null);

// Keep the editor draft across full-page previews, scoped to this signed-in module.
// Nothing is written to browser storage or to the onboarding API.
export function OnboardingDraftProvider({children}:{children:React.ReactNode}) {
  const state=useState<OnboardingTemplate|null>(null);
  return <DraftContext.Provider value={state}>{children}</DraftContext.Provider>;
}

export function useOnboardingDraft() {
  const state=useContext(DraftContext);
  if(!state)throw new Error('Onboarding drafts require the client-onboarding workspace.');
  return state;
}
