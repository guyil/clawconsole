import axios from 'axios';
import toast from 'react-hot-toast';

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const msg =
      error.response?.data?.error ?? error.message ?? 'Unknown error';
    toast.error(msg);
    return Promise.reject(error);
  },
);

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}
