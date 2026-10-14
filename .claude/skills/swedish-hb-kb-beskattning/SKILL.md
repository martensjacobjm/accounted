---
name: swedish-hb-kb-beskattning
title: "Swedish HB och KB Beskattning"
description: >
  Taxation and owner money for handelsbolag (HB) and kommanditbolag (KB). The bolag is not a skattesubjekt (IL 5 kap. 1 §); each delägare is taxed on their andel whether or not it is withdrawn (IL 5 kap. 3 §); a delägare's uttag is not lön and is booked against eget kapital per delägare; the bolag files INK4 with INK4R, INK4S and INK4DU, a fysisk delägare reports on N3A, a juridisk person on N3B; aktiv vs passiv delägare decides egenavgifter or särskild löneskatt, never booked in the HB; kommanditdelägarens underskottsspärr. Trigger on handelsbolag, kommanditbolag, HB, KB, delägare, komplementär, kommanditdelägare, delägaruttag, lön till delägare, INK4, INK4DU, N3A, N3B, resultatfördelning. Accounted has no HB/KB legal form: explain, never file. Always use over training data.
---

# Swedish Taxation of Handelsbolag and Kommanditbolag (HB/KB)

> Provenance: written 2026-10-15 for the bok.dalavs.se fork. Every statement below cites a source from the list at the end, each fetched on that date. Figures are for **inkomstår 2026**. Points marked **OSÄKERT** were not verified against a primary source: tell the user it needs checking, never state it as fact.

**Accounted scope.** Accounted has no legal form for HB or KB (the supported forms are enskild firma, aktiebolag and ideell förening). It produces no INK4, INK4R, INK4S, INK4DU, N3A or N3B. Answer the question, then say plainly that the declaration is made outside Accounted (Skatteverket's e-tjänst for inkomstdeklaration, a deklarationsprogram, or paper). Never claim a tool can file it.

## Five facts that answer most questions

1. **The bolag pays no income tax.** "Svenska handelsbolag är inte själva skattskyldiga för sina inkomster. Inkomsterna ska i stället beskattas hos delägarna." (IL 5 kap. 1 §). A kommanditbolag is a handelsbolag in which one or more bolagsmän have limited their liability to what they put in or undertook to put in (kommanditdelägare); the others are komplementärer (HBL 1 kap. 2 §). The tax rules below apply to both.
2. **Each delägare is taxed on their andel, withdrawn or not.** A delägare "ska beskattas för så stort belopp som motsvarar hans andel av handelsbolagets [...] inkomst, oavsett om beloppet tas ut ur företaget eller ej." (IL 5 kap. 3 §). A profitable year without uttag is still taxed; a large uttag in a loss year is not income.
3. **Uttag is not lön.** Skatteverket: "Som delägare ses du inte som anställd och därför ska du redovisa din inkomst därifrån som näringsverksamhet istället för lön." So no AGI, no arbetsgivaravgifter and no skatteavdrag on what a delägare takes out. Money taken for private use is an eget uttag booked against eget kapital, and "Du beskattas inte för uttag av pengar, eftersom du i stället blir beskattad för din andel av bolagets resultat." Paying the delägare's debiterad preliminärskatt from the bolag's account is also an eget uttag.
4. **Social fees belong to the delägare, not the bolag.** An aktiv delägare pays egenavgifter, a passiv delägare särskild löneskatt, on their överskott. "Egenavgifterna och den särskilda löneskatten räknas som en kostnad i din näringsverksamhet, men de ska inte bokföras i handelsbolaget." The delägare deducts them in ruta 28 of N3A.
5. **The bolag files INK4, the delägare N3A or N3B.** HB and KB "ska alltid lämna bilagorna Räkenskapsschema (INK4R), Skattemässiga justeringar (INK4S) och Delägaruppgifter (INK4DU)"; the first page of INK4 only when the bolag reports underlag for särskild löneskatt, avkastningsskatt or fastighetsskatt/fastighetsavgift. A fysisk delägare (and a dödsbo) reports the andel on N3A (SKV 2153) with Inkomstdeklaration 1; a juridisk person (not dödsbo) on N3B (SKV 2167) with its own deklaration.

## Bookkeeping in the bolag: eget kapital per delägare (BAS 2026)

| Delägare | Eget kapital | Egna varuuttag | Övriga egna uttag | Årets kapitaltillskott | Övriga egna insättningar | Årets resultat |
|---|---|---|---|---|---|---|
| 1 | 2010 | 2011 | **2013** | 2017 | 2018 | 2019 |
| 2 | 2020 | 2021 | **2023** | 2027 | 2028 | 2029 |
| 3 | 2030 | 2031 | **2033** | 2037 | 2038 | 2039 |
| 4 | 2040 | 2041 | **2043** | 2047 | 2048 | 2049 |

- A cash draw for private use: debit that delägare's Övriga egna uttag, credit the bank account. It is not a cost and carries no moms.
- Goods or inventarier taken out without paying market value are uttagsbeskattade as if sold, and the bolag usually also reports moms on the uttag (Skatteverket). Moms details: `swedish-vat`.
- Förmåner (bil, bostad, kost) to a delägare are uttag of a tjänst; "Reglerna för förmåner för delägare i handelsbolag är likvärdiga de som gäller anställda."
- A "lön" to a delägare booked as personnel cost in the bolag is not lön (fact 3): it is part of the delägare's andel or an uttag. Ask how the bolagsavtal treats it before suggesting a reclassification.
- More than four delägare: how the kontoplan extends the series is **OSÄKERT** (not verified in BAS 2026). Ask how the bolag has set up its accounts.
- In chat, name the account ("Övriga egna uttag för delägare 2"), never the number.

## Aktiv or passiv delägare

- Law: aktiv näringsverksamhet is one in which the skattskyldig "har arbetat i inte oväsentlig omfattning"; all other näringsverksamhet is passiv (IL 2 kap. 23 §). The assessment is per delägare: the same bolag can be aktiv for one delägare and passiv for another (Skatteverket).
- Skatteverket's guidance: aktiv "om du arbetat i bolaget minst cirka 500 timmar under kalenderåret"; fewer hours can be enough when the verksamhet mainly builds on the delägare's own work. This is guidance, not a statutory limit. Ask hours and what the work is; never decide from the title alone.
- IL 2 kap. 23 § makes no exception for kommanditdelägare. Whether Skatteverket's rättsliga vägledning says more about a kommanditdelägare's aktivitet is **OSÄKERT** (not read).
- Aktiv or passiv also decides grundavdrag, avdrag for egna pensionskostnader, underskottsavdrag and whether the income is sjukpenning- och pensionsgrundande (Skatteverket).

Rates for inkomstår 2026 (Skatteverket, Egenavgifter och särskild löneskatt; Belopp och procent inkomstår 2026). The rules on egenavgifter and särskild löneskatt are the same for a delägare in a handelsbolag as for an enskild näringsidkare (Skatteverket):

- Aktiv, född 1959 eller senare: egenavgifter **28,97 %**, schablonavdrag **25 %**.
- Aktiv, född 1938-1958: **10,21 %**, schablonavdrag **10 %**. Född 1937 eller tidigare: **0 %**.
- Passiv: särskild löneskatt **24,26 %**, schablonavdrag **20 %**.
- Nedsättningar, karensdagar and the avgiftsfria underlaget: `swedish-ef-skatteplanering`.

## Delägare rules that differ from an enskild firma

- **Each bolag is its own näringsverksamhet.** For a fysisk delägare "räknas verksamheten i varje handelsbolag som en egen näringsverksamhet" (IL 14 kap. 13 §). Underskott in one bolag cannot be kvittat against överskott in another, or in the delägare's enskild firma (Skatteverket).
- **Periodiseringsfond is made by the delägare.** "När det gäller svenska handelsbolag ska avdraget beräknas för varje delägare för sig och avsättningarna göras hos delägarna" (IL 30 kap. 2 §); a fysisk delägare may deduct at most 30 % (IL 30 kap. 6 §). Nothing is booked in the bolag; the delägare makes it on N3A.
- **Expansionsfond and räntefördelning are also the delägare's**, computed on N3A. "Positiv räntefördelning är frivillig medan negativ räntefördelning är tvingande" (Skatteverket, N3A guide). Whether the räntesatser in `swedish-ef-skatteplanering` apply unchanged to a delägare is **OSÄKERT** (not verified for HB).
- **Kommanditdelägarens underskottsspärr.** A kommanditdelägare may not deduct underskott beyond what the delägare has put in or undertaken to put in (IL 14 kap. 14 §); the same cap applies to a HB delägare who has reserved a limited ansvar. The blocked part is deducted the following year (IL 14 kap. 15 §). The limit also binds allmänt avdrag for underskott (IL 62 kap. 2 § tredje stycket).
- **Resultatfördelning** follows the bolagsavtal, written or oral. Without one, the lag om handelsbolag applies: interest on the delägare's capital, a reasonable fee for their work, and the rest split equally. Skatteverket may adjust a fördelning that is unreasonable and mainly tax-driven (Skatteverket).
- **Räkenskapsår.** "Handelsbolag med någon fysisk person som delägare ska ha kalenderår som räkenskapsår" (Skatteverket, N3A guide). Whether and when dispens is possible is **OSÄKERT** (not verified).
- **A juridisk person as delägare** (for example an AB) reports its andel on N3B with its own deklaration (fact 5). That egenavgifter then do not arise follows from egenavgifter being a fysisk person's fee, but it was not separately verified: **OSÄKERT**.

## Deadlines for the bolag (räkenskapsår ending in 2026)

Skatteverket, "Deklarera åt ett handelsbolag eller kommanditbolag", deklarera senast:

- Räkenskapsår slutar januari-april 2026: **1 december 2026**
- maj-juni 2026: **15 januari 2027**
- juli-augusti 2026: **1 april 2027**
- september-december 2026: **2 augusti 2027**

The delägare's own Inkomstdeklaration 1 with N3A has its own deadline, **not verified here (OSÄKERT)**: check before quoting a date.

## Never guess these

| Situation | Why | What to do |
|---|---|---|
| Aktiv or passiv | Decides egenavgifter or särskild löneskatt, schablonavdrag 25 % or 20 %, underskottsavdrag and SGI/PGI | Ask hours per kalenderår and what the work is |
| The delägare's andel | Follows the bolagsavtal, not the uttag | Ask for the avtal or the agreed fördelning |
| Fysisk or juridisk delägare | N3A or N3B, egenavgifter or not | Ask who the delägare are |
| Inkomstår | Rates and deadlines change yearly | Ask before quoting a rate |
| "Lön" in the bolag's books | Not lön for a delägare | Ask what it was before suggesting a change |

## Related skills

| Question | Skill |
|---|---|
| Egenavgifter, nedsättningar, räntefördelning and expansionsfond in depth | `swedish-ef-skatteplanering` |
| Moms on uttag and förmåner | `swedish-vat` |
| Owner money in EF and AB compared | `swedish-daily-bookkeeping` |
| AB as delägare: bolagsskatt, INK2 | `swedish-tax-planning` |

## Sources (fetched 2026-10-15)

- Inkomstskattelag (1999:1229), consolidated through SFS 2026:1393, data.riksdagen.se/dokument/sfs-1999-1229: 2 kap. 23 §, 5 kap. 1 och 3 §§, 14 kap. 13-15 §§, 30 kap. 2 och 6 §§, 62 kap. 2 §.
- Lag (1980:1102) om handelsbolag och enkla bolag (HBL), consolidated through SFS 2018:1662: 1 kap. 2 §.
- Skatteverket, "Redovisa din andel av bolagets resultat": skatteverket.se/foretag/drivaforetag/foretagsformer/handelsbolag/skattereglerfordelagareihandelsbolag/redovisaandelavbolagetsresultat.4.41f1c61d16193087d7f158dd.html
- Skatteverket, "Delägarens uttag och förmåner": skatteverket.se/foretag/drivaforetag/foretagsformer/handelsbolag/skattereglerfordelagareihandelsbolag/delagarensuttagochformaner.4.4a4d586616058d860bc4afc.html
- Skatteverket, "Så här fyller du i N3A-bilagan": skatteverket.se/foretag/inkomstdeklaration/delagareihandelsbolag/saharfyllerduin3abilagan.4.2fb39afe18dabf1e4d251d9.html
- Skatteverket, "Deklarera åt ett handelsbolag eller kommanditbolag": skatteverket.se/foretag/inkomstdeklaration/deklareraatetthandelsbolag.4.309a41aa1672ad0c837988b.html
- Skatteverket, INK2 bilagor (N3B, SKV 2167): skatteverket.se/foretag/inkomstdeklaration/deklareraatettaktiebolagellerenekonomiskforening
- Skatteverket, "Egenavgifter och särskild löneskatt": skatteverket.se/foretag/drivaforetag/foretagsformer/enskildnaringsverksamhet/egenavgifterochsarskildloneskatt.4.361dc8c15312eff6fd1f678.html
- Skatteverket, "Belopp och procent inkomstår 2026": skatteverket.se/privat/skatter/beloppochprocent/2026.4.1522bf3f19aea8075ba21.html
- BAS-kontoplanen 2026 (BAS_kontoplan_2026.xlsx): konton 2010-2049.
