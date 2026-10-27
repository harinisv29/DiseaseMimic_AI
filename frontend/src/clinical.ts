import {z} from 'zod';
import type {Evidence,Observation} from './api';
export const clinicalNotice='Experimental differential-diagnosis research support — not clinically validated for patient care.';
export const coverageNotice='The reference database is rare-disease-oriented. Compatibility scores do not establish real-world prevalence, exclude common diseases, or confirm the highest-ranked condition.';
export const contextSchema=z.object({onset:z.string().max(200),duration:z.string().max(200),familyHistory:z.string().max(1500),exposures:z.string().max(1500),laboratory:z.string().max(1500)});
export type ClinicalContext=z.infer<typeof contextSchema>;
export const emptyClinicalContext=():ClinicalContext=>({onset:'',duration:'',familyHistory:'',exposures:'',laboratory:''});
export const provenanceKinds={'unspecified':'Unspecified source','patient-reported':'Patient-reported','clinician-confirmed':'Clinician-confirmed','documented-record':'Previously documented record'} as const;
export const provenanceText=(o:Observation)=>`${provenanceKinds[o.provenance?.kind||'unspecified']}${o.provenance?.note?': '+o.provenance.note:''}${o.provenance?.recordedAt?' · Recorded '+o.provenance.recordedAt:''}`;
export type ReviewCategory='Clinical history'|'Physical examination'|'Laboratory findings'|'Genetic or molecular findings'|'Previously documented diagnoses'|'Other or unclassified findings';
export const reviewCategories:ReviewCategory[]=['Clinical history','Physical examination','Laboratory findings','Genetic or molecular findings','Previously documented diagnoses','Other or unclassified findings'];
export function reviewCategory(id:string,label:string):ReviewCategory{
 const exact:Record<string,ReviewCategory>={'HP:0001252':'Physical examination','HP:0000252':'Physical examination','HP:0001251':'Physical examination','HP:0001250':'Previously documented diagnoses','HP:0001287':'Previously documented diagnoses','HP:0000407':'Previously documented diagnoses','HP:0009830':'Previously documented diagnoses','HP:0003236':'Laboratory findings','HP:0002719':'Clinical history'};
 if(exact[id])return exact[id];
 if(/inheritance|karyotype|chromosomal|molecular|pathogenic variant/i.test(label))return 'Genetic or molecular findings';
 if(/circulating|serum |plasma |urinary |enzyme activity|on mri|on imaging/i.test(label))return 'Laboratory findings';
 if(/pain|fatigue|headache|recurrent infections|family history|age of onset/i.test(label))return 'Clinical history';
 return 'Other or unclassified findings';
}
export const isNonPhenotype=(p:{id:string;label:string})=>/inheritance|age of onset|neonatal onset|infantile onset|childhood onset|adult onset|mortality/i.test(p.label);
export function profileEvidence(d:Evidence,observations:Observation[]){
 const positive=d.phenotypes.filter(p=>p.state==='present'&&!isNonPhenotype(p));
 const reported=observations.filter(o=>o.state==='present');
 return {matched:reported.filter(o=>positive.some(p=>p.id===o.id)),unmatched:reported.filter(o=>!positive.some(p=>p.id===o.id)),additional:positive.filter(p=>!observations.some(o=>o.id===p.id)),nonPhenotype:d.phenotypes.filter(p=>p.state==='present'&&isNonPhenotype(p)),conflicts:observations.filter(o=>(o.state==='present'&&d.phenotypes.some(p=>p.id===o.id&&p.state==='absent'))||(o.state==='absent'&&positive.some(p=>p.id===o.id)))};
}
export function reviewRationale(id:string,leaders:Evidence[]){if(!leaders.length)return 'Reference evidence is not available; no candidate-specific explanation can be established.';const positive=leaders.filter(d=>d.phenotypes.some(p=>p.id===id&&p.state==='present'));const excluded=leaders.filter(d=>d.phenotypes.some(p=>p.id===id&&p.state==='absent'));return `The backend selected this observation for expected information gain. ${positive.length} of ${leaders.length} loaded leading profiles document a positive association; ${excluded.length} document an explicit exclusion. Other annotations are missing or unresolved, not negative. This may help differentiate source profiles; it does not establish clinical utility.`;}
