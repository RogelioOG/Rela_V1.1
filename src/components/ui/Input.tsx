import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', id, ...props }: InputProps) {
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${error ? 'border-red-400' : 'border-gray-300'} ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}

export function Select({ label, error, className = '', id, children, ...props }: SelectProps) {
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
        </label>
      )}
      <select
        id={id}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${error ? 'border-red-400' : 'border-gray-300'} ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function TextArea({ label, error, className = '', id, ...props }: TextAreaProps) {
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${error ? 'border-red-400' : 'border-gray-300'} ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
