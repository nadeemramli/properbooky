# Changelog

## [1.0.1] - 2024-03-28

### Table of Contents (TOC) Extractor Improvements

#### Added
- Robust error handling for PDF and EPUB TOC extraction
- Type safety improvements across TOC extraction functions
- Input validation for file URLs and formats
- Proper null checks for navigation data
- Standardized ID generation using `crypto.randomUUID()`
- Array type validation for outline data
- Better page number extraction from PDF outlines
- Proper cleanup for EPUB book objects

#### Changed
- Switched from `pdf-lib` to `pdf.js` for PDF outline extraction
- Improved EPUB navigation loading using `book.loaded.navigation`
- Enhanced TOC conversion logic for both PDF and EPUB
- Better error recovery mechanisms
- Standardized error message format

#### Removed
- Removed dependency on `pdf-lib` for outline extraction
- Removed unsafe type assertions
- Eliminated redundant crypto calls

### Default Books System Updates

#### Added
- Proper type alignment with database schema
- JSON conversion utility for metadata
- Better error handling for database operations
- Input validation for user IDs
- Comprehensive error logging

#### Changed
- Improved default book creation logic
- Enhanced database insert operations
- Better type safety for book metadata
- Simplified book data structure
- More robust URL handling for files and covers

#### Fixed
- Type errors in book creation
- Metadata JSON conversion issues
- Database insert type mismatches
- File URL handling edge cases

### Type System Improvements

#### Added
- Better type definitions for book metadata
- Proper typing for database operations
- Type safety for file operations
- Better error type handling

#### Changed
- Improved type structure for book creation
- Enhanced type safety for database operations
- Better type inference for async operations

### Technical Improvements

#### Performance
- Optimized TOC extraction process
- Better memory management for EPUB operations
- Improved error recovery mechanisms

#### Security
- Safer file URL handling
- Better input validation
- Improved error message sanitization

#### Code Quality
- Better code organization
- Improved error handling patterns
- More consistent coding style
- Better type safety throughout
- Comprehensive error logging

### Developer Experience
- Better error messages for debugging
- More consistent error handling patterns
- Improved type safety for better IDE support
- Better code documentation
- More predictable behavior

### Breaking Changes
- Changed TOC extraction API to use `pdf.js`
- Modified book creation type structure
- Updated metadata handling approach

### Migration Guide
If you're upgrading from a previous version, you'll need to:
1. Update any code using `pdf-lib` for TOC extraction to use `pdf.js`
2. Update book creation code to match new type structure
3. Review metadata handling in your code
4. Update any custom TOC extraction implementations

### Future Improvements
- Add support for more document formats
- Enhance TOC extraction accuracy
- Improve performance for large documents
- Add more comprehensive testing
- Enhance error recovery mechanisms 