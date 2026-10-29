import Catalog

/// Catalog's Page Format. The Usage module has its own `PageFormat` (it knows only Catalog IDs),
/// and a module-qualified name does not work here because the Catalog module also has a type
/// called `Catalog`.
public typealias CatalogPageFormat = PageFormat
