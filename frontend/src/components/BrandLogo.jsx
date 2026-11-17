import React, { useState, useEffect } from 'react';

/**
 * Komponen Logo Brand (PT. Wanantara Alesha Sadana):
 * - Mode Siang (Light Mode): menggunakan `/ic_hitam.png` dari folder `frontend/public/ic_hitam.png`
 * - Mode Malam (Dark Mode): menggunakan `/ic_putih.png` dari folder `frontend/public/ic_putih.png`
 */
export default function BrandLogo({ darkMode = false, className = 'w-8 h-8' }) {
  const [imgError, setImgError] = useState(false);
  const src = darkMode ? '/ic_putih.png' : '/ic_hitam.png';

  useEffect(() => {
    setImgError(false);
  }, [darkMode]);

  if (imgError) {
    return (
      <svg
        viewBox="0 0 120 120"
        className={`${className} ${darkMode ? 'text-white' : 'text-slate-900'}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M45 10C48 16 48 23 45 29C42 23 42 16 45 10Z" fill="currentColor" />
        <path d="M28 24C34 25 39 29 41 35C35 34 30 30 28 24Z" fill="currentColor" />
        <path d="M62 24C60 30 55 34 49 35C51 29 56 25 62 24Z" fill="currentColor" />
        <path d="M29 40C35 40 40 44 42 50C36 49 31 45 29 40Z" fill="currentColor" />
        <path d="M61 40C59 45 54 49 48 50C50 44 55 40 61 40Z" fill="currentColor" />
        <path
          d="M10 52C10 85 33 108 60 108C87 108 110 85 110 52C82 52 58 64 43 82C33 67 22 57 10 52Z"
          stroke="currentColor"
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M13 67C25 73 34 83 41 96" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M19 82C26 87 32 94 36 102" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M46 80C63 69 84 65 106 67" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M51 94C67 84 85 81 101 83" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <img
      src={src}
      alt="Logo WAS tCO Project"
      onError={() => setImgError(true)}
      className={`${className} object-contain rounded-lg`}
    />
  );
}

