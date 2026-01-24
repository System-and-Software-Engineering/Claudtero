"""
Docling PDF Text Extraction Service

This service provides a local HTTP API for extracting text from PDFs using Docling.
It runs independently of Zotero and communicates via HTTP requests.

Installation:
    pip install docling flask

Usage:
    python docling_service.py

The service will run on http://localhost:5555
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import sys

try:
    from docling.document_converter import DocumentConverter
    DOCLING_AVAILABLE = True
except ImportError:
    DOCLING_AVAILABLE = False
    print("WARNING: Docling not installed. Install with: pip install docling")

app = Flask(__name__)
CORS(app)  # Enable CORS for Zotero plugin

# Initialize converter only if docling is available
converter = DocumentConverter() if DOCLING_AVAILABLE else None

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'docling_available': DOCLING_AVAILABLE,
        'version': '1.0.0'
    }), 200

@app.route('/extract', methods=['POST'])
def extract_text():
    """Extract text from a PDF file"""
    if not DOCLING_AVAILABLE:
        return jsonify({
            'error': 'Docling not installed',
            'success': False
        }), 500

    data = request.json
    if not data:
        return jsonify({
            'error': 'No JSON data provided',
            'success': False
        }), 400

    pdf_path = data.get('path')
    if not pdf_path:
        return jsonify({
            'error': 'No path provided',
            'success': False
        }), 400

    if not os.path.exists(pdf_path):
        return jsonify({
            'error': f'File not found: {pdf_path}',
            'success': False
        }), 404

    try:
        print(f"Extracting text from: {pdf_path}")
        result = converter.convert(pdf_path)
        text = result.document.export_to_markdown()

        print(f"Successfully extracted {len(text)} characters")
        return jsonify({
            'text': text,
            'success': True,
            'length': len(text)
        })
    except Exception as e:
        print(f"Error extracting text: {str(e)}")
        return jsonify({
            'error': str(e),
            'success': False
        }), 500

if __name__ == '__main__':
    if not DOCLING_AVAILABLE:
        print("\n" + "="*60)
        print("ERROR: Docling is not installed!")
        print("="*60)
        print("\nTo install Docling, run:")
        print("    pip install docling flask flask-cors")
        print("\nThen restart this service.")
        print("="*60 + "\n")
        sys.exit(1)

    print("\n" + "="*60)
    print("Docling PDF Extraction Service")
    print("="*60)
    print("\nService running on: http://localhost:5555")
    print("\nEndpoints:")
    print("  GET  /health  - Check service status")
    print("  POST /extract - Extract text from PDF")
    print("\nPress Ctrl+C to stop")
    print("="*60 + "\n")

    app.run(host='localhost', port=5555, debug=False)

