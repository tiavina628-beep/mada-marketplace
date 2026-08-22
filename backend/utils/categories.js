// Liste fixe de catégories — partagée entre le formulaire fournisseur
// (choix à la proposition) et le filtre client (navigation du catalogue).
// Garder cette liste synchronisée avec CATEGORIES dans chaque
// frontend/*/js/image-utils.js si elle est modifiée.
const CATEGORIES = [
  'Alimentation',
  'Mode & Vêtements',
  'Électronique',
  'Maison & Déco',
  'Beauté & Santé',
  'Enfants & Bébés',
  'Sports & Loisirs',
  'Autre',
];

module.exports = { CATEGORIES };
