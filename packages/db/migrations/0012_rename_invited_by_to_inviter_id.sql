-- Rename invited_by to inviter_id in invitations table for Better Auth compatibility
ALTER TABLE invitations RENAME COLUMN invited_by TO inviter_id;
