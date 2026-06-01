"use client"

import React, { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ButtonLoading } from "@/components/reuseables/loading/ButtonLoading"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle } from "lucide-react"

export interface ConfirmDeleteProps {
  isOpen: boolean
  name: string
  onConfirm: () => Promise<void> | void
  onCancel: () => void
  requireConfirmText?: boolean
  confirmText?: string
  title?: string
  description?: string
  destructiveText?: string
}

export function ConfirmDelete({
  isOpen,
  name,
  onConfirm,
  onCancel,
  requireConfirmText = true,
  confirmText = "confirm",
  title = "Delete Confirmation",
  description,
  destructiveText = "Delete",
}: ConfirmDeleteProps) {
  const [inputValue, setInputValue] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  const canDelete = !requireConfirmText || inputValue.toLowerCase() === confirmText.toLowerCase()

  const handleConfirm = async () => {
    if (!canDelete) return
    
    setIsDeleting(true)
    try {
      await onConfirm()
    } finally {
      setIsDeleting(false)
      setInputValue("")
    }
  }

  const handleCancel = () => {
    setInputValue("")
    onCancel()
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {description || (
              <>
                Are you sure you want to delete <strong>{name}</strong>? This action
                cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {requireConfirmText && (
          <div className="space-y-2 py-4">
            <Label htmlFor="confirm-delete">
              Type <span className="font-mono font-semibold">{confirmText}</span> to
              confirm
            </Label>
            <Input
              id="confirm-delete"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={confirmText}
              className={cn(
                "bg-input",
                canDelete && inputValue && "border-destructive"
              )}
              autoFocus
            />
          </div>
        )}

        <AlertDialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isDeleting}>
            Cancel
          </Button>
          {isDeleting ? (
            <ButtonLoading text="Deleting..." variant="destructive" />
          ) : (
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={!canDelete}
            >
              {destructiveText}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default ConfirmDelete
