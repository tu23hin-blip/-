import { badRequest } from './errors.ts';

/** 依存ゼロの軽量バリデータ。API 入力の形だけを厳密に見る。 */
export type FieldSpec = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  required?: boolean;
  enum?: readonly string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  default?: unknown;
  items?: FieldSpec;
};

export type Spec = Record<string, FieldSpec>;

export function validate<T = Record<string, unknown>>(input: unknown, spec: Spec, path = ''): T {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest(`${path || 'body'} はオブジェクトである必要があります`);
  }
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(spec)) {
    const full = path ? `${path}.${key}` : key;
    let value = src[key];

    if (value === undefined || value === null || value === '') {
      if (field.default !== undefined) {
        out[key] = field.default;
        continue;
      }
      if (field.required) throw badRequest(`${full} は必須です`);
      continue;
    }

    if (field.type === 'number' || field.type === 'integer') {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw badRequest(`${full} は数値である必要があります`);
      if (field.type === 'integer' && !Number.isInteger(n)) throw badRequest(`${full} は整数である必要があります`);
      if (field.min !== undefined && n < field.min) throw badRequest(`${full} は ${field.min} 以上である必要があります`);
      if (field.max !== undefined && n > field.max) throw badRequest(`${full} は ${field.max} 以下である必要があります`);
      out[key] = n;
      continue;
    }

    if (field.type === 'boolean') {
      out[key] = value === true || value === 'true' || value === 1 || value === '1';
      continue;
    }

    if (field.type === 'string') {
      if (typeof value !== 'string') throw badRequest(`${full} は文字列である必要があります`);
      if (field.minLength !== undefined && value.length < field.minLength) {
        throw badRequest(`${full} は ${field.minLength} 文字以上である必要があります`);
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        throw badRequest(`${full} は ${field.maxLength} 文字以下である必要があります`);
      }
      if (field.pattern && !field.pattern.test(value)) throw badRequest(`${full} の形式が不正です`);
      if (field.enum && !field.enum.includes(value)) {
        throw badRequest(`${full} は ${field.enum.join(' | ')} のいずれかである必要があります`);
      }
      out[key] = value;
      continue;
    }

    if (field.type === 'array') {
      if (!Array.isArray(value)) throw badRequest(`${full} は配列である必要があります`);
      if (field.minLength !== undefined && value.length < field.minLength) {
        throw badRequest(`${full} は ${field.minLength} 件以上必要です`);
      }
      out[key] = value;
      continue;
    }

    if (field.type === 'object') {
      if (typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${full} はオブジェクトである必要があります`);
      out[key] = value;
      continue;
    }
  }
  return out as T;
}
