'use client';

import { createContext, useContext } from 'react';
import type { User } from '@/lib/types';

export const UserContext = createContext<User | null>(null);

/** Usuário logado (carregado uma vez no layout do app). */
export function useUser(): User {
  const user = useContext(UserContext);
  if (!user) throw new Error('useUser precisa estar dentro do layout do app');
  return user;
}
