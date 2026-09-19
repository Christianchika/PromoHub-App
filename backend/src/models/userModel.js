import { query } from '../db/index.js';
import bcrypt from 'bcryptjs';

export const createUser = async ({ name, email, password, is_admin = false }) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const sql = `
    INSERT INTO users (name, email, password, is_admin)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `;
  const result = await query(sql, [name, email.toLowerCase(), hashedPassword, is_admin ? 1 : 0]);
  return { id: result.lastID || result.rows[0]?.id, name, email: email.toLowerCase(), is_admin };
};

export const findUserByEmail = async (email) => {
  const sql = `SELECT * FROM users WHERE email = $1`;
  const result = await query(sql, [email.toLowerCase()]);
  return result.rows[0] || null;
};

export const findUserById = async (id) => {
  const sql = `SELECT id, name, email, is_admin, created_at FROM users WHERE id = $1`;
  const result = await query(sql, [id]);
  return result.rows[0] || null;
};

export const getAllUsers = async () => {
  const result = await query('SELECT id, name, email, is_admin, created_at, last_login FROM users ORDER BY created_at DESC');
  return result.rows.map(user => ({ ...user, is_logged_in: Boolean(user.last_login) }));
};

export const updateLastLogin = async (id) => {
  await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [id]);
};
