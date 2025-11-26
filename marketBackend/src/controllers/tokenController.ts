import { Request, Response } from 'express';
import { ApplicationError } from '@lib/errors';

export const createTokenHandler = async (req: Request, res: Response) => {
  const admin = res.locals.admin;

  if (!admin) {
    throw new ApplicationError('Missing admin context', {
      statusCode: 500,
      code: 'missing_admin_context'
    });
  }

  res.status(501).json({ error: 'Not implemented yet' });
};

export const getTokenHandler = async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Not implemented yet' });
};

export const listTokensHandler = async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Not implemented yet' });
};

export const mintTokenHandler = async (req: Request, res: Response) => {
  const admin = res.locals.admin;

  if (!admin) {
    throw new ApplicationError('Missing admin context', {
      statusCode: 500,
      code: 'missing_admin_context'
    });
  }

  res.status(501).json({ error: 'Not implemented yet' });
};

export const transferTokenHandler = async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Not implemented yet' });
};

export const getUserBalanceHandler = async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Not implemented yet' });
};

export const getUserBalancesHandler = async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Not implemented yet' });
};

export const updateComplianceHandler = async (req: Request, res: Response) => {
  const admin = res.locals.admin;

  if (!admin) {
    throw new ApplicationError('Missing admin context', {
      statusCode: 500,
      code: 'missing_admin_context'
    });
  }

  res.status(501).json({ error: 'Not implemented yet' });
};
