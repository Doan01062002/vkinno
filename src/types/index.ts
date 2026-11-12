export interface Packaging {
  type: string;
  capacity_ml: number;
  material: string;
  closure: string;
  carton_pack: string;
  weight_gross_g: number;
}

export interface BiochemicalFeatures {
  water_base?: string;
  ph_range: string;
  arc_safe?: boolean;
  arc_mechanism?: string;
  aluminum_protection?: string;
  biofilm_removal?: string;
  dilution_ratio?: string;
  [key: string]: string | boolean | undefined;
}

export interface Product {
  id: number;
  name: string;
  slug: string;
  sku: string;
  brand: string;
  category_id: number;
  category_name: string;
  category_slug: string;
  price_vnd: number;
  listed_price_vnd: number;
  vat_included: boolean;
  vat_rate: number;
  stock: number;
  is_new: number;
  is_bestseller: number;
  is_combo?: boolean;
  bom_skus?: string[];
  image_url: string;
  volume_ml: number;
  packaging: Packaging;
  ingredients: string[];
  biochemical_features: BiochemicalFeatures;
  shelf_life_months: number;
  safety_notes: string;
  dwell_time_note: string;
  prohibited_surfaces: string;
  hazard_classification: string;
  storage_zone: string;
  target_segments: string[];
  usage_instructions: string[];
  certifications?: string[];
}
