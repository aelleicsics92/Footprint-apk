// Conoscenza ecologica per specie (valori indicativi da letteratura tecnica e prassi dei raccoglitori:
// schede tartufi Regione Piemonte / Emilia-Romagna, studi su B. edulis, T. magnatum). Non sono garanzie.
// Generi forestali usati dal motore habitat
export const GEN = ['fagus', 'quercus', 'castanea', 'carpinus', 'corylus', 'ripar', 'tilia', 'picea', 'abies', 'pinus', 'larix'];
export const GEN_NAME = { fagus: 'faggio', quercus: 'querce', castanea: 'castagno', carpinus: 'carpini e orniello', corylus: 'nocciolo', ripar: 'pioppi e salici', tilia: 'tigli', picea: 'abete rosso', abies: 'abete bianco', pinus: 'pini', larix: 'larice' };

// hosts: affinità simbiotica 0..1 | alt: [ottimo da, ottimo a, zero sotto, zero sopra] | asp: cool (N-NE), warm (S-SO), any
// slope: [ideale fino a °, zero oltre °] | tpi: valley (fondovalle), mid (versante), any | ph: [ottimo da, a] o null
// open: tollera aree aperte/arbusteti | wet: gradisce acqua vicina (fosso, torrente)
export const SPECIES = {
  autunnali: [
    { id: 'edulis', name: 'Boletus edulis', hosts: { fagus: 1, picea: 1, abies: 0.8, castanea: 0.8, quercus: 0.5, pinus: 0.4, carpinus: 0.3 }, alt: [700, 1700, 300, 2100], asp: 'cool', slope: [30, 50], tpi: 'any', ph: [4.2, 7.0], note: 'faggete e peccete, versanti freschi' },
    { id: 'aereus', name: 'Boletus aereus (porcino nero)', hosts: { quercus: 1, castanea: 0.9, carpinus: 0.3, fagus: 0.25 }, alt: [250, 900, 0, 1300], asp: 'warm', slope: [30, 50], tpi: 'any', ph: [4.5, 7.2], note: 'querceti e castagneti caldi, bassa quota', season: [150, 290] },
    { id: 'pinophilus', name: 'Boletus pinophilus (pinareccio)', hosts: { pinus: 1, picea: 0.9, abies: 0.8, fagus: 0.35 }, alt: [900, 1900, 400, 2300], asp: 'any', slope: [30, 50], tpi: 'any', ph: [4.0, 6.5], note: 'pinete e peccete di montagna, suolo acido' },
    { id: 'aestivalis', name: 'Boletus aestivalis (porcino estivo)', hosts: { fagus: 1, quercus: 0.9, castanea: 0.8, carpinus: 0.4, picea: 0.3 }, alt: [300, 1300, 100, 1700], asp: 'cool', slope: [30, 50], tpi: 'any', ph: [4.5, 7.0], note: 'primo a uscire nei boschi di latifoglie', season: [140, 240] },
  ],
  estivi: [
    { id: 'galletto', name: 'Galletto (Cantharellus cibarius)', hosts: { picea: 1, abies: 0.9, fagus: 0.9, quercus: 0.8, castanea: 0.8, pinus: 0.5, carpinus: 0.5 }, alt: [400, 1500, 100, 1900], asp: 'cool', slope: [30, 50], tpi: 'any', ph: [4.5, 7.0], note: 'boschi freschi e muschiosi' },
    { id: 'ovolo', name: 'Ovolo (Amanita caesarea)', hosts: { quercus: 1, castanea: 1, carpinus: 0.3 }, alt: [100, 800, 0, 1100], asp: 'warm', slope: [30, 50], tpi: 'any', ph: [4.5, 7.0], note: 'querceti e castagneti caldi' },
  ],
  scorzone: [
    { id: 'aestivum', name: 'Tuber aestivum', hosts: { quercus: 1, carpinus: 0.9, corylus: 0.9, tilia: 0.8, fagus: 0.6, pinus: 0.6, ripar: 0.6, castanea: 0.3 }, alt: [50, 700, 0, 1000], asp: 'any', slope: [25, 40], tpi: 'any', ph: [7.0, 8.4], open: 0.5, note: 'suolo calcareo, limoso, ben drenato' },
  ],
  uncinato: [
    { id: 'uncinatum', name: 'Tuber uncinatum', hosts: { quercus: 1, carpinus: 0.9, corylus: 0.8, pinus: 0.7, fagus: 0.6, tilia: 0.5 }, alt: [250, 900, 50, 1200], asp: 'any', slope: [25, 40], tpi: 'any', ph: [6.8, 8.4], open: 0.3, note: 'boschi anche ombrosi (cerro, roverella, carpino)' },
  ],
  bianco: [
    { id: 'magnatum', name: 'Tuber magnatum', hosts: { ripar: 1, tilia: 1, quercus: 0.9, corylus: 0.9, carpinus: 0.8, fagus: 0.1, pinus: 0.05 }, alt: [80, 600, 0, 975], asp: 'cool', aspSoft: true, slope: [15, 35], tpi: 'valley', ph: [7.2, 8.4], open: 0.35, wet: true, note: 'fondovalle, impluvi e fossi, suolo marnoso profondo' },
  ],
  nero: [
    { id: 'melanosporum', name: 'Tuber melanosporum', hosts: { quercus: 1, corylus: 0.8, carpinus: 0.7, pinus: 0.3, fagus: 0.1 }, alt: [350, 950, 150, 1300], asp: 'warm', slope: [30, 42], tpi: 'mid', ph: [7.4, 8.5], open: 0.75, note: 'boschi radi soleggiati, calcare con scheletro, mai ristagni' },
  ],
  bianchetto: [
    { id: 'borchii', name: 'Tuber borchii', hosts: { pinus: 1, quercus: 0.8, ripar: 0.8, tilia: 0.7, corylus: 0.6, carpinus: 0.5, fagus: 0.3 }, alt: [0, 650, 0, 1000], asp: 'any', slope: [25, 40], tpi: 'any', ph: [6.5, 8.4], open: 0.4, note: 'pinete e boschi su suoli sciolti e sabbiosi' },
  ],
};
