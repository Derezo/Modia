// Name pools for procedural character name generation
// Organized by race and gender type
// This file uses ESM format for modern JavaScript compatibility

export const NAME_POOLS = {
  human: {
    male: [
      'William', 'Marcus', 'Roland', 'Geoffrey', 'Edmund',
      'Baldwin', 'Richard', 'Thomas', 'Henry', 'Robert',
      'Walter', 'Simon', 'Hugh', 'Gilbert', 'Ralph',
      'Stephen', 'Roger', 'Bernard', 'Gerald', 'Cedric'
    ],
    female: [
      'Eleanor', 'Isabelle', 'Margaret', 'Catherine', 'Beatrice',
      'Matilda', 'Constance', 'Adelaide', 'Rosalind', 'Guinevere',
      'Cordelia', 'Helena', 'Josephine', 'Arabella', 'Evangeline',
      'Vivienne', 'Genevieve', 'Millicent', 'Rosamund', 'Annabelle'
    ],
    unisex: [
      'Morgan', 'Avery', 'Jordan', 'Rowan', 'Quinn',
      'Sage', 'Devon', 'Riley', 'Casey', 'Finley',
      'Blair', 'Emery', 'Kendall', 'Reese', 'Shannon',
      'Darcy', 'Ellis', 'Hayden', 'Lane', 'Peyton'
    ]
  },

  elf: {
    male: [
      'Thandril', 'Aelindor', 'Sylvaris', 'Faelorn', 'Caelithor',
      'Erevan', 'Galadhrim', 'Ilmryn', 'Kethryllia', 'Lorindel',
      'Mirthal', 'Naeris', 'Quelith', 'Rylanthir', 'Seldarin',
      'Thaelar', 'Vaelorn', 'Xiloscient', 'Yathandir', 'Zephyros'
    ],
    female: [
      'Aelindra', 'Caelynn', 'Eilonwy', 'Faelwen', 'Galadriel',
      'Isilwen', 'Liriel', 'Maelis', 'Nymeria', 'Oreleth',
      'Quelenna', 'Raelis', 'Silmeriel', 'Thessaly', 'Ulindra',
      'Vaelith', 'Windara', 'Xilthara', 'Yuelith', 'Zariel'
    ],
    unisex: [
      'Aerin', 'Celeborn', 'Elaith', 'Faelar', 'Glynnis',
      'Ithildin', 'Kael', 'Laurelin', 'Melian', 'Nieryn',
      'Olorin', 'Phaelyn', 'Quilyn', 'Rivain', 'Solaith',
      'Tyriel', 'Ulwyn', 'Vanyar', 'Wyneth', 'Yllaris'
    ]
  },

  dwarf: {
    male: [
      'Grimnak', 'Thorin', 'Balin', 'Dwalin', 'Bofur',
      'Bombur', 'Gloin', 'Oin', 'Bifur', 'Nori',
      'Dori', 'Kili', 'Fili', 'Gimli', 'Fundin',
      'Thrain', 'Thror', 'Durin', 'Dain', 'Borin'
    ],
    female: [
      'Beldra', 'Thordis', 'Hilda', 'Brunhild', 'Dagny',
      'Freydis', 'Gerta', 'Helga', 'Ingrid', 'Jord',
      'Katla', 'Lagertha', 'Magna', 'Norna', 'Olga',
      'Ragnhild', 'Sigrid', 'Thora', 'Ulfhild', 'Vigdis'
    ],
    unisex: [
      'Bruni', 'Dvalinn', 'Fjalar', 'Galar', 'Hreidmar',
      'Ivaldi', 'Jorund', 'Kvasi', 'Lofar', 'Mimir',
      'Nabbi', 'Ori', 'Regin', 'Sindri', 'Tjaldur',
      'Ulfar', 'Vidar', 'Yngvi', 'Zorn', 'Austri'
    ]
  },

  vampire: {
    male: [
      'Vladimir', 'Corvinus', 'Lucian', 'Damien', 'Malachar',
      'Valerius', 'Dracul', 'Nostromus', 'Azrael', 'Caspian',
      'Dominic', 'Erebus', 'Faustus', 'Gideon', 'Hadrian',
      'Ignatius', 'Lazarus', 'Mordecai', 'Nicodemus', 'Orpheus'
    ],
    female: [
      'Seraphina', 'Lilith', 'Carmilla', 'Countess', 'Desdemona',
      'Elvira', 'Hecate', 'Isolde', 'Jezebel', 'Kira',
      'Lamia', 'Morrigan', 'Nyx', 'Ophelia', 'Persephone',
      'Ravenna', 'Selene', 'Thana', 'Ursula', 'Vesper'
    ],
    unisex: [
      'Ash', 'Blood', 'Crimson', 'Dusk', 'Eclipse',
      'Frost', 'Grey', 'Haven', 'Ivory', 'Jade',
      'Kyrielle', 'Lestat', 'Midnight', 'Noctis', 'Onyx',
      'Phoenix', 'Raven', 'Shadow', 'Tempest', 'Umbra'
    ]
  },

  orc: {
    male: [
      'Grukh', 'Mograk', 'Thokk', 'Urzul', 'Brugash',
      'Durgash', 'Ghorza', 'Kragmar', 'Lurbuk', 'Murbag',
      'Nagrub', 'Ogdul', 'Parguk', 'Ragash', 'Shagdub',
      'Thragg', 'Ulmog', 'Varkul', 'Wurgoth', 'Yazgash'
    ],
    female: [
      'Zasha', 'Borgakh', 'Dulug', 'Garakh', 'Ghorbash',
      'Mogak', 'Murob', 'Shelur', 'Shalug', 'Urzoga',
      'Bagrak', 'Gashna', 'Mazoga', 'Rogmesh', 'Shel',
      'Ugak', 'Umog', 'Yatul', 'Atub', 'Bolar'
    ],
    unisex: [
      'Grom', 'Kor', 'Rak', 'Thok', 'Zug',
      'Ash', 'Brug', 'Drok', 'Gash', 'Hur',
      'Krug', 'Lug', 'Mok', 'Nok', 'Pok',
      'Ruk', 'Skar', 'Tusk', 'Uzg', 'Vrok'
    ]
  }
};
